const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const multer = require('multer');
const path = require('path');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Middleware de autenticación
const authenticateUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No se proporcionó token de autenticación' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) throw error;
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

// Configuración de multer para el manejo de archivos
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // límite de 5MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Tipo de archivo no válido. Solo se permiten imágenes.'));
    }
  }
});

// Función para crear el perfil del usuario si no existe
async function ensureUserProfile(userId, email, supabase) {
  try {
    // Verificar si el usuario ya existe en la tabla users
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (checkError) {
      console.error('Error al verificar usuario:', checkError);
      throw checkError;
    }

    // Si el usuario no existe, crearlo
    if (!existingUser) {
      console.log('Creando perfil de usuario para:', userId);
      
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
    console.error('Error en ensureUserProfile:', error);
    throw error;
  }
}

// Función para validar campos de catálogo
async function validateCatalogFields(supabase, updates) {
  if (updates.language) {
    const { data: language, error: langError } = await supabase
      .from('languages')
      .select('code')
      .eq('code', updates.language)
      .single();

    if (langError || !language) {
      throw new Error('Idioma no válido. Use uno de los códigos del catálogo.');
    }
  }

  if (updates.gender) {
    const { data: gender, error: genderError } = await supabase
      .from('genders')
      .select('code')
      .eq('code', updates.gender)
      .single();

    if (genderError || !gender) {
      throw new Error('Género no válido. Use uno de los códigos del catálogo.');
    }
  }
}

// Obtener perfil de usuario
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const { data: profile, error } = await supabase
      .from('profiles')
      .select(`
        *,
        stats:user_stats (
          bookings,
          favorites,
          reviews
        )
      `)
      .eq('id', req.params.id)
      .single();

    if (error) throw error;

    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Obtener catálogos
router.get('/catalogs', authenticateUser, async (req, res) => {
  try {
    // Obtener idiomas
    const { data: languages, error: langError } = await supabase
      .from('languages')
      .select('code, name')
      .order('name');

    if (langError) throw langError;

    // Obtener géneros
    const { data: genders, error: genderError } = await supabase
      .from('genders')
      .select('code, name')
      .order('name');

    if (genderError) throw genderError;

    res.json({
      languages,
      genders
    });
  } catch (error) {
    console.error('Error al obtener catálogos:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar perfil de usuario
router.put('/:id', authenticateUser, async (req, res) => {
  try {
    // Verificar que el usuario solo pueda actualizar su propio perfil
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'No autorizado para actualizar este perfil' });
    }

    const { data, error } = await supabase
      .from('profiles')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Actualizar imagen de perfil
router.put('/:id/profile-image', authenticateUser, async (req, res) => {
  try {
    // Verificar que el usuario solo pueda actualizar su propia imagen
    if (req.user.id !== req.params.id) {
      return res.status(403).json({ error: 'No autorizado para actualizar esta imagen' });
    }

    if (!req.files || !req.files.image) {
      return res.status(400).json({ error: 'No se proporcionó ninguna imagen' });
    }

    const image = req.files.image;
    const fileExt = image.name.split('.').pop();
    const fileName = `${req.params.id}-${Date.now()}.${fileExt}`;

    // Subir imagen a Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('profile-images')
      .upload(fileName, image.data);

    if (uploadError) throw uploadError;

    // Obtener URL pública de la imagen
    const { data: { publicUrl } } = supabase.storage
      .from('profile-images')
      .getPublicUrl(fileName);

    // Actualizar URL de la imagen en el perfil
    const { data, error } = await supabase
      .from('profiles')
      .update({ profileImage: publicUrl })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;

    res.json({ imageUrl: publicUrl });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router; 