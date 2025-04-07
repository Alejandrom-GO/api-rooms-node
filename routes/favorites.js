const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

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

// GET /api/favorites
router.get('/', authenticateUser, async (req, res) => {
  try {
    const { sort = 'created_at:desc', page = 1, limit = 10 } = req.query;

    let query = req.supabase
      .from('favorites')
      .select(`
        *,
        room:rooms (
          *,
          room_images(*),
          room_amenities(amenities(*))
        )
      `)
      .eq('user_id', req.user.id);

    // Aplicar ordenamiento
    const [column, order] = sort.split(':');
    query = query.order(column, { ascending: order === 'asc' });

    // Aplicar paginación
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: favorites, error, count } = await query;

    if (error) throw error;

    // Calcular paginación
    const totalPages = Math.ceil(count / limit);

    res.json({
      data: favorites.map(fav => ({
        ...fav.room,
        images: fav.room.room_images ? fav.room.room_images.map(img => img.url) : [],
        isNew: (new Date() - new Date(fav.room.created_at)) < 7 * 24 * 60 * 60 * 1000
      })),
      pagination: {
        total: count,
        currentPage: parseInt(page),
        totalPages,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error al obtener favoritos:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/favorites
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.body;

    // Verificar si la habitación existe
    const { data: room, error: roomError } = await req.supabase
      .from('rooms')
      .select('id')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Verificar si ya está en favoritos
    const { data: existingFavorite, error: checkError } = await req.supabase
      .from('favorites')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('room_id', roomId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      throw checkError;
    }

    if (existingFavorite) {
      return res.status(400).json({ error: 'La habitación ya está en favoritos' });
    }

    // Agregar a favoritos
    const { data: favorite, error: favoriteError } = await req.supabase
      .from('favorites')
      .insert([
        {
          user_id: req.user.id,
          room_id: roomId
        }
      ])
      .select()
      .single();

    if (favoriteError) throw favoriteError;

    // Actualizar contador de favoritos en user_stats
    const { error: statsError } = await req.supabase
      .from('user_stats')
      .update({ favorites: req.supabase.raw('favorites + 1') })
      .eq('user_id', req.user.id);

    if (statsError) throw statsError;

    res.status(201).json({
      success: true,
      favorite
    });
  } catch (error) {
    console.error('Error al agregar a favoritos:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/favorites/:roomId
router.delete('/:roomId', authenticateUser, async (req, res) => {
  try {
    const { roomId } = req.params;

    const { error: deleteError } = await req.supabase
      .from('favorites')
      .delete()
      .eq('user_id', req.user.id)
      .eq('room_id', roomId);

    if (deleteError) throw deleteError;

    // Actualizar contador de favoritos en user_stats
    const { error: statsError } = await req.supabase
      .from('user_stats')
      .update({ favorites: req.supabase.raw('favorites - 1') })
      .eq('user_id', req.user.id);

    if (statsError) throw statsError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar de favoritos:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/collections
router.post('/collections', authenticateUser, async (req, res) => {
  try {
    const { name, description, roomIds } = req.body;

    // Crear la colección
    const { data: collection, error: collectionError } = await req.supabase
      .from('collections')
      .insert([
        {
          name,
          description,
          user_id: req.user.id
        }
      ])
      .select()
      .single();

    if (collectionError) throw collectionError;

    // Agregar las habitaciones a la colección
    if (roomIds && roomIds.length > 0) {
      const collectionRooms = roomIds.map(roomId => ({
        collection_id: collection.id,
        room_id: roomId
      }));

      const { error: roomsError } = await req.supabase
        .from('collection_rooms')
        .insert(collectionRooms);

      if (roomsError) throw roomsError;
    }

    res.status(201).json(collection);
  } catch (error) {
    console.error('Error al crear colección:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/collections
router.get('/collections', authenticateUser, async (req, res) => {
  try {
    const { data: collections, error } = await req.supabase
      .from('collections')
      .select(`
        *,
        collection_rooms(
          room:rooms(
            *,
            room_images(*)
          )
        )
      `)
      .eq('user_id', req.user.id);

    if (error) throw error;

    res.json(collections.map(collection => ({
      ...collection,
      rooms: collection.collection_rooms.map(cr => ({
        ...cr.room,
        images: cr.room.room_images ? cr.room.room_images.map(img => img.url) : []
      }))
    })));
  } catch (error) {
    console.error('Error al obtener colecciones:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 