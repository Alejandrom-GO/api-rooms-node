const { supabase } = require('../utils/supabase');

// Función para crear el perfil del usuario
async function createUserProfile(userId, email) {
  try {
    // Verificar si el usuario ya existe en la tabla users
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error al verificar usuario existente:', checkError);
      throw checkError;
    }

    // Si el usuario no existe, crearlo
    if (!existingUser) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .insert([
          {
            id: userId,
            email: email,
            name: email.split('@')[0], // Nombre por defecto basado en el email
          }
        ])
        .select()
        .single();

      if (userError) {
        console.error('Error al crear usuario:', userError);
        throw userError;
      }

      // Crear estadísticas iniciales del usuario
      const { error: statsError } = await supabase
        .from('user_stats')
        .insert([
          {
            user_id: userId,
            bookings: 0,
            favorites: 0,
            reviews: 0
          }
        ]);

      if (statsError) {
        console.error('Error al crear estadísticas:', statsError);
        throw statsError;
      }

      return userData;
    }

    return existingUser;
  } catch (error) {
    console.error('Error en createUserProfile:', error);
    throw error;
  }
}

// Manejador de la función serverless
module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Manejar solicitudes OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Solo permitir POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    console.log('Intentando login con:', { email });
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Error de Supabase en login:', error);
      return res.status(400).json({ 
        error: error.message,
        code: error.code
      });
    }

    if (!data || !data.user) {
      return res.status(400).json({ 
        error: 'No se pudo obtener la información del usuario' 
      });
    }

    try {
      // Crear o obtener el perfil del usuario
      const userData = await createUserProfile(data.user.id, email);
      
      res.status(200).json({
        message: 'Login exitoso',
        session: data.session,
        user: userData
      });
    } catch (profileError) {
      console.error('Error al crear/obtener perfil:', profileError);
      // Aún así devolvemos la sesión aunque falle la creación del perfil
      res.status(200).json({
        message: 'Login exitoso, pero hubo un error al obtener el perfil',
        session: data.session,
        user: data.user
      });
    }
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 