const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

// Configuración de Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware para verificar autenticación
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No se proporcionó token de autenticación' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error) {
      console.error('Error de autenticación:', error);
      throw error;
    }
    
    req.user = user;
    next();
  } catch (error) {
    console.error('Error en middleware de autenticación:', error);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
};

// Middleware para verificar si el usuario es administrador
const isAdmin = async (req, res, next) => {
  try {
    // Verificar si el usuario está intentando acceder a su propia configuración
    const requestedUserId = req.params.userId;
    if (requestedUserId === req.user.id) {
      console.log('Usuario accediendo a su propia configuración, permitiendo acceso');
      return next();
    }

    // Si no es su propia configuración, verificar si es administrador
    console.log('Verificando si el usuario es administrador');
    
    // Verificar si la tabla user_roles existe
    const { error: tableError } = await supabase
      .from('user_roles')
      .select('count')
      .limit(1);
    
    if (tableError) {
      console.error('Error al verificar tabla user_roles:', tableError);
      
      // Si la tabla no existe, crear un endpoint alternativo para obtener la configuración
      if (tableError.code === '42P01') {
        console.log('La tabla user_roles no existe, permitiendo acceso temporalmente');
        return next();
      }
      
      throw tableError;
    }
    
    // Verificar si el usuario tiene rol de administrador
    const { data: userRole, error: roleError } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', req.user.id)
      .single();
    
    if (roleError) {
      console.error('Error al verificar rol de usuario:', roleError);
      
      // Si no hay registros, permitir acceso temporalmente
      if (roleError.code === 'PGRST116') {
        console.log('No se encontró rol para el usuario, permitiendo acceso temporalmente');
        return next();
      }
      
      throw roleError;
    }
    
    if (userRole && userRole.role === 'admin') {
      console.log('Usuario es administrador, permitiendo acceso');
      next();
    } else {
      console.log('Usuario no es administrador, denegando acceso');
      res.status(403).json({ error: 'No tienes permisos de administrador' });
    }
  } catch (error) {
    console.error('Error al verificar rol de administrador:', error);
    res.status(500).json({ error: 'Error al verificar permisos' });
  }
};

// Función para obtener configuración por defecto
const getDefaultSettings = (userId) => ({
  id: null,
  user_id: userId,
  notifications: {
    email: true,
    push: true,
    sms: false,
    marketing: false
  },
  privacy: {
    profileVisibility: "public",
    activityVisibility: "private"
  },
  security: {
    twoFactorAuth: false,
    lastPasswordChange: new Date().toISOString()
  },
  preferences: {
    currency: "MXN",
    darkMode: false,
    language: "es",
    timezone: "America/Mexico_City"
  },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString()
});

// Función para formatear la configuración
const formatSettings = (settings) => {
  return {
    id: settings.id,
    user_id: settings.user_id,
    notifications: settings.notifications || {
      email: true,
      push: true,
      sms: false,
      marketing: false
    },
    privacy: settings.privacy || {
      profileVisibility: "public",
      activityVisibility: "private"
    },
    security: settings.security || {
      twoFactorAuth: false,
      lastPasswordChange: settings.created_at
    },
    preferences: {
      currency: settings.currency || "MXN",
      darkMode: settings.theme === 'dark',
      language: settings.language || "es",
      timezone: settings.timezone || "America/Mexico_City"
    },
    created_at: settings.created_at,
    updated_at: settings.updated_at
  };
};

// Función para crear o actualizar la configuración de un usuario
const createOrUpdateSettings = async (userId, settings = null) => {
  try {
    console.log('Creando o actualizando configuración para usuario:', userId);
    
    // Si no se proporcionan settings, usar valores por defecto
    const defaultSettings = getDefaultSettings(userId);
    const settingsToInsert = settings || defaultSettings;
    
    // Intentar insertar o actualizar
    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: userId,
        notifications: settingsToInsert.notifications,
        privacy: settingsToInsert.privacy,
        security: settingsToInsert.security,
        currency: settingsToInsert.preferences.currency,
        theme: settingsToInsert.preferences.darkMode ? 'dark' : 'light',
        language: settingsToInsert.preferences.language,
        timezone: settingsToInsert.preferences.timezone,
        updated_at: new Date().toISOString()
      })
      .select()
      .limit(1);
    
    if (error) {
      console.error('Error al crear/actualizar user_settings:', error);
      throw error;
    }
    
    console.log('Configuración creada/actualizada:', data[0]);
    return data[0];
  } catch (error) {
    console.error('Error en createOrUpdateSettings:', error);
    throw error;
  }
};

// Obtener configuración del usuario actual
router.get('/', authenticateUser, async (req, res) => {
  try {
    console.log('Intentando obtener configuración para usuario:', req.user.id);
    
    // Primero, verificar si la tabla existe
    const { error: tableCheckError } = await supabase
      .from('user_settings')
      .select('count')
      .limit(1);
    
    if (tableCheckError) {
      console.error('Error al verificar tabla user_settings:', tableCheckError);
      if (tableCheckError.code === '42P01') {
        console.log('La tabla user_settings no existe, devolviendo valores por defecto');
        return res.json(getDefaultSettings(req.user.id));
      }
      throw tableCheckError;
    }
    
    // Obtener la configuración del usuario
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', req.user.id)
      .limit(1);

    if (error) {
      console.error('Error al consultar user_settings:', error);
      throw error;
    }

    console.log('Datos obtenidos de la base de datos:', data);

    if (!data || data.length === 0) {
      console.log('No se encontró configuración para el usuario, creando una nueva');
      // Crear una nueva configuración para el usuario
      const newSettings = await createOrUpdateSettings(req.user.id);
      return res.json(formatSettings(newSettings));
    }

    // Asegurarnos de que la configuración tenga el formato correcto
    const formattedSettings = formatSettings(data[0]);

    console.log('Configuración encontrada y formateada:', formattedSettings);
    res.json(formattedSettings);
  } catch (error) {
    console.error('Error al obtener configuración:', error);
    res.status(500).json({ 
      error: 'Error al obtener la configuración',
      details: error.message,
      code: error.code
    });
  }
});

// Obtener configuración de un usuario específico (solo para administradores)
router.get('/user/:userId', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Intentando obtener configuración para usuario:', userId);
    
    // Primero, verificar si la tabla existe
    const { error: tableCheckError } = await supabase
      .from('user_settings')
      .select('count')
      .limit(1);
    
    if (tableCheckError) {
      console.error('Error al verificar tabla user_settings:', tableCheckError);
      if (tableCheckError.code === '42P01') {
        console.log('La tabla user_settings no existe, devolviendo valores por defecto');
        return res.json(getDefaultSettings(userId));
      }
      throw tableCheckError;
    }
    
    // Obtener la configuración del usuario
    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .limit(1);

    if (error) {
      console.error('Error al consultar user_settings:', error);
      throw error;
    }

    console.log('Datos obtenidos de la base de datos:', data);

    if (!data || data.length === 0) {
      console.log('No se encontró configuración para el usuario, creando una nueva');
      // Crear una nueva configuración para el usuario
      const newSettings = await createOrUpdateSettings(userId);
      return res.json(formatSettings(newSettings));
    }

    // Asegurarnos de que la configuración tenga el formato correcto
    const formattedSettings = formatSettings(data[0]);

    console.log('Configuración encontrada y formateada:', formattedSettings);
    res.json(formattedSettings);
  } catch (error) {
    console.error('Error al obtener configuración:', error);
    res.status(500).json({ 
      error: 'Error al obtener la configuración',
      details: error.message,
      code: error.code
    });
  }
});

// Actualizar configuración del usuario
router.put('/', authenticateUser, async (req, res) => {
  try {
    const { notifications, privacy, security, preferences } = req.body;
    console.log('Actualizando configuración para usuario:', req.user.id, req.body);

    const settingsToUpdate = {
      notifications,
      privacy,
      security,
      currency: preferences?.currency,
      theme: preferences?.darkMode ? 'dark' : 'light',
      language: preferences?.language,
      timezone: preferences?.timezone,
      updated_at: new Date().toISOString()
    };

    // Primero intentamos actualizar
    const { data: updateData, error: updateError } = await supabase
      .from('user_settings')
      .update(settingsToUpdate)
      .eq('user_id', req.user.id)
      .select()
      .limit(1);

    // Si no hay registros para actualizar, insertamos uno nuevo
    if (updateError || !updateData || updateData.length === 0) {
      const defaultSettings = getDefaultSettings(req.user.id);
      const settingsToInsert = {
        ...defaultSettings,
        ...settingsToUpdate,
        user_id: req.user.id
      };

      const { data: insertData, error: insertError } = await supabase
        .from('user_settings')
        .insert(settingsToInsert)
        .select()
        .limit(1);

      if (insertError) {
        console.error('Error al insertar user_settings:', insertError);
        throw insertError;
      }

      console.log('Nueva configuración creada:', insertData[0]);
      return res.json(formatSettings(insertData[0]));
    }

    console.log('Configuración actualizada:', updateData[0]);
    res.json(formatSettings(updateData[0]));
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ 
      error: 'Error al actualizar la configuración',
      details: error.message,
      code: error.code
    });
  }
});

// Actualizar configuración de un usuario específico (solo para administradores)
router.put('/user/:userId', authenticateUser, isAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { notifications, privacy, security, preferences } = req.body;
    console.log('Actualizando configuración para usuario:', userId, req.body);

    const settingsToUpdate = {
      notifications,
      privacy,
      security,
      currency: preferences?.currency,
      theme: preferences?.darkMode ? 'dark' : 'light',
      language: preferences?.language,
      timezone: preferences?.timezone,
      updated_at: new Date().toISOString()
    };

    // Primero intentamos actualizar
    const { data: updateData, error: updateError } = await supabase
      .from('user_settings')
      .update(settingsToUpdate)
      .eq('user_id', userId)
      .select()
      .limit(1);

    // Si no hay registros para actualizar, insertamos uno nuevo
    if (updateError || !updateData || updateData.length === 0) {
      const defaultSettings = getDefaultSettings(userId);
      const settingsToInsert = {
        ...defaultSettings,
        ...settingsToUpdate,
        user_id: userId
      };

      const { data: insertData, error: insertError } = await supabase
        .from('user_settings')
        .insert(settingsToInsert)
        .select()
        .limit(1);

      if (insertError) {
        console.error('Error al insertar user_settings:', insertError);
        throw insertError;
      }

      console.log('Nueva configuración creada:', insertData[0]);
      return res.json(formatSettings(insertData[0]));
    }

    console.log('Configuración actualizada:', updateData[0]);
    res.json(formatSettings(updateData[0]));
  } catch (error) {
    console.error('Error al actualizar configuración:', error);
    res.status(500).json({ 
      error: 'Error al actualizar la configuración',
      details: error.message,
      code: error.code
    });
  }
});

module.exports = router; 