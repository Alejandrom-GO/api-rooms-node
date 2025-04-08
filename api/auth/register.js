const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Verificación de variables de entorno
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas en register.js');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Configurada' : 'No configurada');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Configurada' : 'No configurada');
}

// Inicialización de Supabase con opciones específicas
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

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

    console.log('Intentando registro con:', { email });
    
    // Registrar usuario en Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) {
      console.error('Error de Supabase en registro:', authError);
      return res.status(400).json({ 
        error: authError.message,
        code: authError.code
      });
    }

    if (!authData || !authData.user) {
      console.error('No se pudo obtener la información del usuario después del registro');
      return res.status(400).json({ 
        error: 'No se pudo obtener la información del usuario' 
      });
    }

    try {
      // Crear perfil de usuario
      const userData = await createUserProfile(authData.user.id, email);
      
      res.status(201).json({
        message: 'Usuario registrado exitosamente',
        user: userData
      });
    } catch (profileError) {
      console.error('Error al crear perfil:', profileError);
      // Aún así devolvemos la información del usuario aunque falle la creación del perfil
      res.status(201).json({
        message: 'Usuario registrado, pero hubo un error al crear el perfil',
        user: authData.user
      });
    }
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}; 