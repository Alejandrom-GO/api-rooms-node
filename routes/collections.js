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

// GET /api/collections
router.get('/', authenticateUser, async (req, res) => {
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

// POST /api/collections
router.post('/', authenticateUser, async (req, res) => {
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

// PUT /api/collections/:id
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, roomIds } = req.body;

    // Verificar que la colección pertenece al usuario
    const { data: existingCollection, error: checkError } = await req.supabase
      .from('collections')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (checkError || !existingCollection) {
      return res.status(404).json({ error: 'Colección no encontrada' });
    }

    // Actualizar la colección
    const { data: collection, error: updateError } = await req.supabase
      .from('collections')
      .update({ name, description })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Actualizar las habitaciones si se proporcionan
    if (roomIds) {
      // Eliminar las relaciones existentes
      const { error: deleteError } = await req.supabase
        .from('collection_rooms')
        .delete()
        .eq('collection_id', id);

      if (deleteError) throw deleteError;

      // Insertar las nuevas relaciones
      if (roomIds.length > 0) {
        const collectionRooms = roomIds.map(roomId => ({
          collection_id: id,
          room_id: roomId
        }));

        const { error: insertError } = await req.supabase
          .from('collection_rooms')
          .insert(collectionRooms);

        if (insertError) throw insertError;
      }
    }

    res.json(collection);
  } catch (error) {
    console.error('Error al actualizar colección:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/collections/:id
router.delete('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la colección pertenece al usuario
    const { data: existingCollection, error: checkError } = await req.supabase
      .from('collections')
      .select('id')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (checkError || !existingCollection) {
      return res.status(404).json({ error: 'Colección no encontrada' });
    }

    // Eliminar la colección (las relaciones se eliminarán por CASCADE)
    const { error: deleteError } = await req.supabase
      .from('collections')
      .delete()
      .eq('id', id);

    if (deleteError) throw deleteError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error al eliminar colección:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 