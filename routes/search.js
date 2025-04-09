const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Verificación de variables de entorno
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas en search.js');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Configurada' : 'No configurada');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Configurada' : 'No configurada');
  throw new Error('Configuración de Supabase incompleta en search.js');
}

// Inicialización de Supabase con opciones específicas
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

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

// Obtener sugerencias de búsqueda
router.get('/search-suggestions', authenticateUser, async (req, res) => {
  try {
    const { query } = req.query;
    
    if (!query || query.length < 2) {
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Buscar en habitaciones
    const { data: rooms, error: roomsError } = await req.supabase
      .from('rooms')
      .select('id, name, location')
      .ilike('name', `%${query}%`)
      .limit(5);

    if (roomsError) {
      console.error('Error al buscar habitaciones:', roomsError);
    }

    // Buscar en ubicaciones
    const { data: locations, error: locationsError } = await req.supabase
      .from('locations')
      .select('id, name, city')
      .ilike('name', `%${query}%`)
      .limit(5);

    if (locationsError) {
      console.error('Error al buscar ubicaciones:', locationsError);
    }

    // Combinar resultados
    const suggestions = [
      ...(rooms || []).map(room => ({
        type: 'room',
        id: room.id,
        name: room.name,
        location: room.location
      })),
      ...(locations || []).map(location => ({
        type: 'location',
        id: location.id,
        name: location.name,
        city: location.city
      }))
    ];

    return res.status(200).json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('Error inesperado al obtener sugerencias:', error);
    return res.status(500).json({
      success: false,
      error: 'Error inesperado al obtener sugerencias',
      details: error.message
    });
  }
});

// Obtener ubicaciones populares
router.get('/locations', authenticateUser, async (req, res) => {
  try {
    const { data, error } = await req.supabase
      .from('locations')
      .select('*')
      .order('popularity', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Error al obtener ubicaciones populares:', error);
      return res.status(500).json({
        success: false,
        error: 'Error al obtener ubicaciones populares',
        details: error.message
      });
    }

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('Error inesperado al obtener ubicaciones populares:', error);
    return res.status(500).json({
      success: false,
      error: 'Error inesperado al obtener ubicaciones populares',
      details: error.message
    });
  }
});

module.exports = router; 