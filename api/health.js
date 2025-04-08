const { supabase, supabaseUrl, supabaseKey } = require('./utils/supabase');

// Verificación de variables de entorno
if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas en health.js');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Configurada' : 'No configurada');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Configurada' : 'No configurada');
}

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
    res.json({ 
      status: 'ok', 
      message: 'API funcionando correctamente',
      env: {
        supabaseUrl: supabaseUrl ? 'Configurada' : 'No configurada',
        supabaseKey: supabaseKey ? 'Configurada' : 'No configurada',
        nodeEnv: process.env.NODE_ENV || 'No configurado'
      }
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error interno del servidor',
      error: error.message
    });
  }
}; 