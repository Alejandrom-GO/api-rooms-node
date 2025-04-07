const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Middleware para verificar autenticación
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No se proporcionó token de autenticación' });
    }

    const token = authHeader.split(' ')[1];
    
    // Crear cliente de Supabase con el token del usuario
    const supabase = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    });

    const { data: { user }, error } = await supabase.auth.getUser();

    if (error || !user) {
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }

    req.user = user;
    req.supabase = supabase;
    next();
  } catch (error) {
    console.error('Error de autenticación:', error);
    res.status(500).json({ error: 'Error de autenticación' });
  }
};

// Configuración de multer para el manejo de imágenes
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes'));
    }
  }
});

// GET /api/rooms
router.get('/', authenticateUser, async (req, res) => {
  try {
    const {
      location,
      minPrice,
      maxPrice,
      type,
      amenities,
      sort = 'created_at',
      page = 1,
      limit = 10
    } = req.query;

    let query = req.supabase
      .from('rooms')
      .select(`
        *,
        room_images(*),
        room_amenities(amenities(*))
      `);

    // Aplicar filtros
    if (location) {
      query = query.ilike('location', `%${location}%`);
    }
    if (minPrice) {
      query = query.gte('price', minPrice);
    }
    if (maxPrice) {
      query = query.lte('price', maxPrice);
    }
    if (type) {
      query = query.eq('type', type);
    }
    if (amenities) {
      const amenityIds = amenities.split(',');
      query = query.contains('amenities', amenityIds);
    }

    // Aplicar ordenamiento
    const [column, order] = sort.split(':');
    query = query.order(column, { ascending: order === 'asc' });

    // Aplicar paginación
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: rooms, error, count } = await query;

    if (error) throw error;

    // Calcular paginación
    const totalPages = Math.ceil(count / limit);

    res.json({
      data: rooms.map(room => ({
        ...room,
        images: room.room_images ? room.room_images.map(img => img.url) : [],
        isNew: (new Date() - new Date(room.created_at)) < 7 * 24 * 60 * 60 * 1000
      })),
      pagination: {
        total: count,
        currentPage: page,
        totalPages,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error al obtener habitaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/featured
router.get('/featured', authenticateUser, async (req, res) => {
  try {
    const { data: rooms, error } = await req.supabase
      .from('rooms')
      .select(`
        *,
        room_images(url, is_primary)
      `)
      .eq('is_featured', true)
      .limit(10);

    if (error) throw error;

    res.json({
      data: rooms.map(room => ({
        ...room,
        images: room.images.map(img => img.url),
        amenities: room.amenities.map(a => a.amenity),
        isNew: (new Date() - new Date(room.created_at)) < 7 * 24 * 60 * 60 * 1000
      }))
    });
  } catch (error) {
    console.error('Error al obtener habitaciones destacadas:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/:id
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    // Primero obtenemos los datos básicos de la habitación
    const { data: room, error: roomError } = await req.supabase
      .from('rooms')
      .select('*')
      .eq('id', id)
      .single();

    if (roomError) {
      console.error('Error al obtener la habitación:', roomError);
      return res.status(500).json({ error: roomError.message });
    }

    if (!room) {
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Luego obtenemos las imágenes relacionadas
    const { data: images, error: imagesError } = await req.supabase
      .from('room_images')
      .select('*')
      .eq('room_id', id);

    if (imagesError) {
      console.error('Error al obtener las imágenes:', imagesError);
      return res.status(500).json({ error: imagesError.message });
    }

    // Obtenemos el host (usuario) de manera separada
    const { data: host, error: hostError } = await req.supabase
      .from('users')
      .select('id, name, email, profileImage')
      .eq('id', room.host_id)
      .single();

    if (hostError) {
      console.error('Error al obtener el host:', hostError);
      // No retornamos error aquí, continuamos con datos parciales
    }

    res.json({
      ...room,
      images: images ? images.map(img => ({
        id: img.id,
        url: img.url,
        isPrimary: img.is_primary,
        createdAt: img.created_at
      })) : [],
      host: host || null
    });

  } catch (error) {
    console.error('Error al obtener detalles de la habitación:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/:id/images
router.get('/:id/images', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: room_images, error } = await req.supabase
      .from('room_images')
      .select('*')
      .eq('room_id', id)
      .order('is_primary', { ascending: false });

    if (error) throw error;

    if (!room_images || room_images.length === 0) {
      return res.status(404).json({ error: 'No se encontraron imágenes para esta habitación' });
    }

    res.json({
      data: room_images.map(img => ({
        id: img.id,
        url: img.url,
        isPrimary: img.is_primary,
        createdAt: img.created_at
      }))
    });
  } catch (error) {
    console.error('Error al obtener imágenes de la habitación:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/rooms/search
router.post('/search', async (req, res) => {
  try {
    const { type, maxPrice } = req.body;

    let query = req.supabase
      .from('rooms')
      .select(`
        *,
        room_images(url)
      `);

    if (type) {
      query = query.eq('type', type);
    }
    if (maxPrice) {
      query = query.lte('price', maxPrice);
    }

    const { data: rooms, error } = await query;

    if (error) throw error;

    res.json({
      data: rooms.map(room => ({
        ...room,
        images: room.room_images ? room.room_images.map(img => img.url) : []
      }))
    });
  } catch (error) {
    console.error('Error al buscar habitaciones:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/image/:imageId
router.get('/image/:imageId', authenticateUser, async (req, res) => {
  try {
    const { imageId } = req.params;

    const { data: image, error } = await req.supabase
      .from('room_images')
      .select(`
        *,
        rooms(id, title, location)
      `)
      .eq('id', imageId)
      .single();

    if (error) throw error;

    if (!image) {
      return res.status(404).json({ error: 'No se encontró la imagen' });
    }

    res.json({
      data: {
        id: image.id,
        url: image.url,
        isPrimary: image.is_primary,
        createdAt: image.created_at,
        room: image.rooms ? {
          id: image.rooms.id,
          title: image.rooms.title,
          location: image.rooms.location
        } : null
      }
    });
  } catch (error) {
    console.error('Error al obtener la imagen:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rooms/images/all
router.get('/images/all', authenticateUser, async (req, res) => {
  try {
    const { room_id } = req.query;

    console.log('Tipo de room_id:', typeof room_id);
    console.log('Valor de room_id:', room_id);

    // Primero, hacer una consulta simple sin joins para verificar
    const { data: simpleImages, error: simpleError } = await req.supabase
      .from('room_images')
      .select('*');

    console.log('Todas las imágenes en la base de datos:', simpleImages);

    let query = req.supabase
      .from('room_images')
      .select('*');

    if (room_id) {
      // Asegurarse de que el room_id sea exactamente igual
      query = query.eq('room_id', room_id.trim());
    }

    const { data: images, error, count } = await query;

    if (error) {
      console.error('Error en la consulta:', error);
      throw error;
    }

    console.log('Query ejecutada para room_id específico');
    console.log('Número de imágenes encontradas:', count);
    console.log('Datos obtenidos:', images);

    if (!images || images.length === 0) {
      return res.json({
        success: false,
        data: [],
        message: 'No se encontraron imágenes para esta habitación',
        debug: {
          providedRoomId: room_id,
          totalImagesInDB: simpleImages ? simpleImages.length : 0
        }
      });
    }

    res.json({
      success: true,
      data: images.map(image => ({
        id: image.id,
        url: image.url,
        isPrimary: image.is_primary,
        roomId: image.room_id,
        createdAt: image.created_at
      })),
      count: images.length,
      debug: {
        providedRoomId: room_id,
        totalImagesInDB: simpleImages ? simpleImages.length : 0
      }
    });

  } catch (error) {
    console.error('Error al obtener las imágenes:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      debug: {
        providedRoomId: req.query.room_id
      }
    });
  }
});

module.exports = router; 