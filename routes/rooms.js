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

router.get('/featured', authenticateUser, async (req, res) => {
  try {
    const { data: rooms, error } = await req.supabase
      .from('rooms')
      .select(`
        *,
        room_images(url, is_primary),
        room_amenities(
          amenities(
            id,
            name,
            icon
          )
        )
      `)
      .eq('is_featured', true)
      .limit(10);

    if (error) throw error;

    res.json({
      data: rooms.map(room => ({
        ...room,
        images: room.room_images ? room.room_images.map(img => img.url) : [],
        amenities: room.room_amenities ? room.room_amenities.map(ra => ({
          id: ra.amenities.id,
          name: ra.amenities.name,
          icon: ra.amenities.icon
        })) : [],
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
    console.log('Buscando habitación con ID:', id);

    // Primero verificamos si la habitación existe sin joins
    const { data: roomExists, error: roomExistsError } = await req.supabase
      .from('rooms')
      .select('id')
      .eq('id', id);

    if (roomExistsError) {
      console.error('Error al verificar si la habitación existe:', roomExistsError);
      return res.status(500).json({ 
        error: 'Error al verificar si la habitación existe',
        details: roomExistsError.message,
        code: roomExistsError.code 
      });
    }

    console.log('Resultado de verificación de habitación:', roomExists);

    if (!roomExists || roomExists.length === 0) {
      console.log('Habitación no encontrada con ID:', id);
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Ahora obtenemos los datos completos con los joins
    const { data: rooms, error: roomError } = await req.supabase
      .from('rooms')
      .select(`
        *,
        room_amenities(
          amenities(
            id,
            name,
            icon
          )
        )
      `)
      .eq('id', id);

    if (roomError) {
      console.error('Error al obtener la habitación con detalles:', roomError);
      return res.status(500).json({ 
        error: 'Error al obtener la habitación con detalles',
        details: roomError.message,
        code: roomError.code 
      });
    }

    if (!rooms || rooms.length === 0) {
      console.log('Habitación no encontrada con detalles, ID:', id);
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Tomamos la primera habitación encontrada
    const room = rooms[0];
    console.log('Habitación encontrada con detalles:', room);

    console.log('Room amenities raw data:', room.room_amenities);
    
    // Procesamos las amenities directamente desde el join, filtrando los nulls
    const amenitiesData = room.room_amenities 
      ? room.room_amenities
          .filter(ra => ra && ra.amenities) // Filtrar entradas null o sin amenities
          .map(ra => ({
            id: ra.amenities.id,
            name: ra.amenities.name,
            icon: ra.amenities.icon
          }))
      : [];
    
    console.log('Processed amenities data:', amenitiesData);

    // Luego obtenemos las imágenes relacionadas
    const { data: images, error: imagesError } = await req.supabase
      .from('room_images')
      .select('*')
      .eq('room_id', id);

    if (imagesError) {
      console.error('Error al obtener las imágenes:', imagesError);
      return res.status(500).json({ 
        error: 'Error al obtener las imágenes',
        details: imagesError.message,
        code: imagesError.code
      });
    }

    console.log('Imágenes encontradas:', images?.length || 0);

    // Obtenemos el host (usuario) de manera separada
    const { data: host, error: hostError } = await req.supabase
      .from('users')
      .select('id, name, email, profileimage')
      .eq('id', room.host_id)
      .single();

    if (hostError) {
      console.error('Error al obtener el host:', hostError);
    }

    const response = {
      ...room,
      images: images ? images.map(img => ({
        id: img.id,
        url: img.url,
        isPrimary: img.is_primary,
        createdAt: img.created_at
      })) : [],
      amenities: amenitiesData,
      host: host || null
    };

    console.log('Enviando respuesta exitosa con amenities:', response.amenities);
    res.json(response);

  } catch (error) {
    console.error('Error inesperado al obtener detalles de la habitación:', error);
    res.status(500).json({ 
      error: 'Error inesperado al obtener detalles de la habitación',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
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
router.post('/search', authenticateUser, async (req, res) => {
  try {
    const { type, maxPrice } = req.body;
    console.log('Búsqueda con parámetros:', { type, maxPrice });

    let query = req.supabase
      .from('rooms')
      .select(`
        *,
        room_images(url, is_primary)
      `);

    if (type) {
      query = query.eq('type', type);
    }
    if (maxPrice) {
      query = query.lte('price', maxPrice);
    }

    const { data: rooms, error } = await query;

    if (error) {
      console.error('Error en la consulta:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al realizar la búsqueda',
        details: error.message
      });
    }

    if (!rooms || rooms.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: 'No se encontraron habitaciones con los criterios especificados'
      });
    }

    const formattedRooms = rooms.map(room => ({
      id: room.id,
      name: room.name,
      description: room.description,
      price: room.price,
      type: room.type,
      location: room.location,
      rating: room.rating,
      images: room.room_images ? room.room_images.map(img => ({
        url: img.url,
        isPrimary: img.is_primary
      })) : [],
      created_at: room.created_at,
      updated_at: room.updated_at
    }));

    res.status(200).json({
      success: true,
      data: formattedRooms,
      count: formattedRooms.length
    });
  } catch (error) {
    console.error('Error inesperado al buscar habitaciones:', error);
    res.status(500).json({
      success: false,
      error: 'Error inesperado al buscar habitaciones',
      details: error.message
    });
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

// GET /api/rooms/:id/amenities
router.get('/:id/amenities', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    console.log('Buscando amenidades para la habitación con ID:', id);

    // Primero verificamos que la habitación existe
    const { data: roomExists, error: roomExistsError } = await req.supabase
      .from('rooms')
      .select('id')
      .eq('id', id);

    if (roomExistsError) {
      console.error('Error al verificar si la habitación existe:', roomExistsError);
      return res.status(500).json({ 
        error: 'Error al verificar si la habitación existe',
        details: roomExistsError.message
      });
    }

    if (!roomExists || roomExists.length === 0) {
      console.log('Habitación no encontrada con ID:', id);
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Verificar todas las room_amenities para debug
    const { data: allRoomAmenities, error: allRoomAmenitiesError } = await req.supabase
      .from('room_amenities')
      .select('*')
      .eq('id', id);
    
    console.log('Todas las room_amenities en la base de datos:', allRoomAmenities);
    
    if (allRoomAmenitiesError) {
      console.error('Error al consultar todas las room_amenities:', allRoomAmenitiesError);
    }

    // Obtenemos los IDs de las amenities para esta habitación
    const { data: roomAmenities, error: roomAmenitiesError } = await req.supabase
      .from('room_amenities')
      .select('*')
      .eq('room_id', id);

    if (roomAmenitiesError) {
      console.error('Error al obtener los IDs de amenities:', roomAmenitiesError);
      return res.status(500).json({ 
        error: 'Error al obtener los IDs de amenities',
        details: roomAmenitiesError.message
      });
    }

    console.log('Room amenities para esta habitación:', roomAmenities);

    // Extraer los IDs de amenities
    const amenityIds = roomAmenities ? roomAmenities.map(ra => ra.amenity_id).filter(id => id) : [];
    console.log('IDs de amenities extraídos:', amenityIds);

    // Verificar todas las amenities para debug
    const { data: allAmenities, error: allAmenitiesError } = await req.supabase
      .from('amenities')
      .select('*')
      .limit(50);
    
    console.log('Todas las amenities en la base de datos:', allAmenities);
    
    if (allAmenitiesError) {
      console.error('Error al consultar todas las amenities:', allAmenitiesError);
    }

    // Si no hay amenities, devolver array vacío
    if (amenityIds.length === 0) {
      return res.json({
        success: true,
        data: [],
        debug: {
          roomId: id,
          roomExists: !!roomExists.length,
          roomAmenitiesCount: roomAmenities ? roomAmenities.length : 0,
          allRoomAmenitiesCount: allRoomAmenities ? allRoomAmenities.length : 0,
          allAmenitiesCount: allAmenities ? allAmenities.length : 0
        }
      });
    }

    // Obtener los detalles de las amenities
    let amenitiesData = [];
    if (amenityIds.length > 0) {
      const { data: amenities, error: amenitiesError } = await req.supabase
        .from('amenities')
        .select('id, name, icon')
        .in('id', amenityIds);

      if (amenitiesError) {
        console.error('Error al obtener los detalles de las amenities:', amenitiesError);
      } else if (amenities) {
        amenitiesData = amenities;
        console.log('Amenities encontradas:', amenities);
      }
    }
    
    // Si no encontramos datos, usamos algunos de prueba para verificar la estructura
    if (amenitiesData.length === 0 && allAmenities && allAmenities.length > 0) {
      console.log('Usando amenities de ejemplo para mostrar la estructura de datos');
      // Usar las primeras 3 amenities como ejemplo (solo si no hay datos para la habitación)
      amenitiesData = allAmenities.slice(0, 3).map(amenity => ({
        id: amenity.id,
        name: amenity.name,
        icon: amenity.icon,
        _isExample: true  // Marcamos estos como ejemplos
      }));
    }

    // Luego obtenemos las imágenes relacionadas
    const { data: images, error: imagesError } = await req.supabase
      .from('room_images')
      .select('*')
      .eq('room_id', id);

    if (imagesError) {
      console.error('Error al obtener las imágenes:', imagesError);
      return res.status(500).json({ 
        error: 'Error al obtener las imágenes',
        details: imagesError.message,
        code: imagesError.code
      });
    }

    console.log('Imágenes encontradas:', images?.length || 0);

    // Obtenemos el host (usuario) de manera separada
    const { data: host, error: hostError } = await req.supabase
      .from('users')
      .select('id, name, email, profileimage')
      .eq('id', room.host_id)
      .single();

    if (hostError) {
      console.error('Error al obtener el host:', hostError);
    }

    const response = {
      ...room,
      images: images ? images.map(img => ({
        id: img.id,
        url: img.url,
        isPrimary: img.is_primary,
        createdAt: img.created_at
      })) : [],
      amenities: amenitiesData,
      host: host || null
    };

    console.log('Enviando respuesta exitosa con amenities:', response.amenities);
    res.json(response);

  } catch (error) {
    console.error('Error inesperado al obtener amenities de la habitación:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error inesperado al obtener amenities de la habitación',
      details: error.message
    });
  }
});

module.exports = router; 