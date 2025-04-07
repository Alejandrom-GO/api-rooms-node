const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

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
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Crear o obtener el perfil del usuario
    const userData = await createUserProfile(data.user.id, email);

    res.status(200).json({
      message: 'Login exitoso',
      session: data.session,
      user: userData
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(400).json({ error: error.message });
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

module.exports = router; 