const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Verificación de variables de entorno
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas en health.js');
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

// Manejador de la función serverless
module.exports = async (req, res) => {
  // Configurar CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Manejar solicitudes OPTIONS (preflight)
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Solo permitir GET
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    // Intentar obtener la información del usuario actual
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      // Si hay error de autenticación, pero el servidor responde, significa que la conexión está bien
      res.json({ 
        status: 'ok', 
        message: 'Conexión con Supabase establecida',
        auth: 'No autenticado',
        env: {
          supabaseUrl: supabaseUrl ? 'Configurada' : 'No configurada',
          supabaseKey: supabaseKey ? 'Configurada' : 'No configurada',
          nodeEnv: process.env.NODE_ENV || 'No configurado'
        }
      });
    } else {
      res.json({ 
        status: 'ok', 
        message: 'Conexión con Supabase establecida',
        auth: 'Autenticado',
        user: user,
        env: {
          supabaseUrl: supabaseUrl ? 'Configurada' : 'No configurada',
          supabaseKey: supabaseKey ? 'Configurada' : 'No configurada',
          nodeEnv: process.env.NODE_ENV || 'No configurado'
        }
      });
    }
  } catch (error) {
    console.error('Error de conexión con Supabase:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error de conexión con Supabase',
      error: error.message,
      env: {
        supabaseUrl: supabaseUrl ? 'Configurada' : 'No configurada',
        supabaseKey: supabaseKey ? 'Configurada' : 'No configurada',
        nodeEnv: process.env.NODE_ENV || 'No configurado'
      }
    });
  }
}; 