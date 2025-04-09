// Cargar variables de entorno primero
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// Verificación de variables de entorno
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Variables de entorno de Supabase no configuradas');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Configurada' : 'No configurada');
  console.error('SUPABASE_ANON_KEY:', supabaseKey ? 'Configurada' : 'No configurada');
  process.exit(1); // Terminar el proceso si las variables no están configuradas
}

const app = express();

// Importar rutas
const authRoutes = require('./routes/auth');

// Middleware
app.use(cors());
app.use(express.json());

// Montar rutas
app.use('/api/auth', authRoutes);

// Inicialización de Supabase con opciones específicas
const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// Middleware para verificar la conexión con Supabase
app.use(async (req, res, next) => {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Error de conexión con Supabase:', error);
    }
    next();
  } catch (error) {
    console.error('Error en middleware de Supabase:', error);
    next();
  }
});

// Verificar conexión con Supabase
app.get('/api/health', async (req, res) => {
  try {
    // Intentar obtener la información del usuario actual
    const { data: { user }, error } = await supabase.auth.getUser();
    
    if (error) {
      // Si hay error de autenticación, pero el servidor responde, significa que la conexión está bien
      res.json({ 
        status: 'ok', 
        message: 'Conexión con Supabase establecida',
        auth: 'No autenticado'
      });
    } else {
      res.json({ 
        status: 'ok', 
        message: 'Conexión con Supabase establecida',
        auth: 'Autenticado',
        user: user
      });
    }
  } catch (error) {
    console.error('Error de conexión con Supabase:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Error de conexión con Supabase',
      error: error.message 
    });
  }
});

// Rutas
const userRoutes = require('./routes/users');
const roomRoutes = require('./routes/rooms');
const favoriteRoutes = require('./routes/favorites');
const collectionRoutes = require('./routes/collections');
const bookingRoutes = require('./routes/bookings');
const settingsRoutes = require('./routes/settings');
const paymentRoutes = require('./routes/payments');

app.use('/api/users', userRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/payments', paymentRoutes);

// Manejo de errores global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    status: 'error',
    message: 'Error interno del servidor',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Para desarrollo local
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
    console.log('URL de Supabase:', supabaseUrl);
  });
}

// Para Vercel
module.exports = app; 