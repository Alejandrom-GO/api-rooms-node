const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Verificación de variables de entorno
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas en auth.js');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Configurada' : 'No configurada');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Configurada' : 'No configurada');
  throw new Error('Configuración de Supabase incompleta en auth.js');
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
    console.log('Verificando autenticación...');
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      console.log('No se encontró header de autorización');
      return res.status(401).json({ 
        success: false,
        error: 'No se proporcionó token de autenticación' 
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      console.log('No se encontró token en el header');
      return res.status(401).json({ 
        success: false,
        error: 'Formato de token inválido' 
      });
    }
    
    console.log('Creando cliente Supabase con token...');
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

    console.log('Verificando usuario con Supabase...');
    const { data: { user }, error } = await supabase.auth.getUser();

    if (error) {
      console.error('Error al verificar usuario:', error);
      return res.status(401).json({ 
        success: false,
        error: 'Error al verificar token',
        details: error.message 
      });
    }

    if (!user) {
      console.log('No se encontró usuario');
      return res.status(401).json({ 
        success: false,
        error: 'Token inválido o expirado' 
      });
    }

    console.log('Usuario autenticado:', user.id);
    req.user = user;
    req.supabase = supabase;
    next();
  } catch (error) {
    console.error('Error de autenticación:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error de autenticación',
      details: error.message 
    });
  }
};

// Función para crear el perfil del usuario
async function createUserProfile(userId, email) {
  // Verificar si el usuario ya existe en la tabla users
  const { data: existingUser, error: checkError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (checkError && checkError.code !== 'PGRST116') {
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

    if (userError) throw userError;

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

    if (statsError) throw statsError;

    return userData;
  }

  return existingUser;
}

// Ruta de registro
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Registrar usuario en Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError) throw authError;

    // Crear perfil de usuario
    const userData = await createUserProfile(authData.user.id, email);

    res.status(201).json({
      message: 'Usuario registrado exitosamente',
      user: userData
    });
  } catch (error) {
    console.error('Error en registro:', error);
    res.status(400).json({ error: error.message });
  }
});

// Ruta de login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email y contraseña son requeridos' 
      });
    }

    console.log('Intentando login con:', { email });
    
    // Verificar conexión con Supabase antes de intentar el login
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error('Error al verificar sesión:', sessionError);
    }

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
      console.error('No se pudo obtener la información del usuario después del login');
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
});

// Ruta de logout
router.post('/logout', async (req, res) => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    res.status(200).json({ message: 'Logout exitoso' });
  } catch (error) {
    console.error('Error en logout:', error);
    res.status(400).json({ error: error.message });
  }
});

// Ruta para obtener el usuario actual
router.get('/me', authenticateUser, async (req, res) => {
  try {
    const { data: user, error } = await req.supabase
      .from('users')
      .select(`
        *,
        stats:user_stats (
          bookings,
          favorites,
          reviews
        )
      `)
      .eq('id', req.user.id)
      .single();

    if (error) throw error;

    res.json({ user });
  } catch (error) {
    console.error('Error al obtener usuario actual:', error);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint para verificar la validez del token
router.all('/verify-token', authenticateUser, async (req, res) => {
  try {
    // Si el middleware authenticateUser pasa, significa que el token es válido
    const user = req.user;
    
    // Obtener información adicional del usuario desde la base de datos
    const { data: userData, error: userError } = await req.supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (userError) {
      console.error('Error al obtener datos del usuario:', userError);
      // Si hay error al obtener datos adicionales, devolvemos al menos la información básica
      return res.status(200).json({
        success: true,
        message: 'Token válido',
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          metadata: user.user_metadata
        }
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Token válido',
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        metadata: user.user_metadata,
        ...userData // Incluir datos adicionales del usuario
      }
    });
  } catch (error) {
    console.error('Error al verificar token:', error);
    return res.status(401).json({
      success: false,
      message: 'Token inválido o expirado',
      error: error.message
    });
  }
});

module.exports = router; 