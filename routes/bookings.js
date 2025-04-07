const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

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

// GET /api/bookings
router.get('/', authenticateUser, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    let query = req.supabase
      .from('bookings')
      .select(`
        *,
        room:rooms (
          id,
          title,
          room_images (
            url,
            is_primary
          )
        )
      `)
      .eq('user_id', req.user.id);

    // Aplicar filtro de estado si se proporciona
    if (status) {
      query = query.eq('status', status);
    }

    // Aplicar paginación
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: bookings, error, count } = await query;

    if (error) throw error;

    // Calcular paginación
    const totalPages = Math.ceil(count / limit);

    res.json({
      data: bookings.map(booking => ({
        id: booking.id,
        roomId: booking.room_id,
        roomName: booking.room.title,
        roomImage: booking.room.room_images.find(img => img.is_primary)?.url || 
                  (booking.room.room_images[0]?.url || null),
        startDate: booking.start_date,
        endDate: booking.end_date,
        price: booking.price,
        status: booking.status,
        createdAt: booking.created_at
      })),
      pagination: {
        total: count,
        currentPage: parseInt(page),
        totalPages,
        hasMore: page < totalPages
      }
    });
  } catch (error) {
    console.error('Error al obtener reservas:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/bookings
router.post('/', authenticateUser, async (req, res) => {
  try {
    const { roomId, startDate, endDate } = req.body;

    // Verificar que la habitación existe
    const { data: room, error: roomError } = await req.supabase
      .from('rooms')
      .select('price')
      .eq('id', roomId)
      .single();

    if (roomError || !room) {
      return res.status(404).json({ error: 'Habitación no encontrada' });
    }

    // Calcular el precio total
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    const totalPrice = room.price * days;

    // Crear la reserva
    const { data: booking, error: bookingError } = await req.supabase
      .from('bookings')
      .insert([
        {
          user_id: req.user.id,
          room_id: roomId,
          start_date: startDate,
          end_date: endDate,
          price: totalPrice,
          status: 'active'
        }
      ])
      .select(`
        *,
        room:rooms (
          id,
          title,
          room_images (
            url,
            is_primary
          )
        )
      `)
      .single();

    if (bookingError) throw bookingError;

    // Actualizar contador de reservas en user_stats
    const { error: statsError } = await req.supabase
      .from('user_stats')
      .update({ bookings: req.supabase.raw('bookings + 1') })
      .eq('user_id', req.user.id);

    if (statsError) throw statsError;

    res.status(201).json({
      id: booking.id,
      roomId: booking.room_id,
      roomName: booking.room.title,
      roomImage: booking.room.room_images.find(img => img.is_primary)?.url || 
                (booking.room.room_images[0]?.url || null),
      startDate: booking.start_date,
      endDate: booking.end_date,
      price: booking.price,
      status: booking.status,
      createdAt: booking.created_at
    });
  } catch (error) {
    console.error('Error al crear reserva:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/bookings/:id
router.get('/:id', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: booking, error } = await req.supabase
      .from('bookings')
      .select(`
        *,
        room:rooms (
          *,
          room_images(*),
          host:users (
            id,
            name,
            profileImage
          ),
          reviews (
            *,
            user:users (
              id,
              name,
              profileImage
            )
          )
        )
      `)
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (error) throw error;

    if (!booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    // Calcular promedio de reseñas
    const reviews = booking.room.reviews || [];
    const averageRating = reviews.length > 0
      ? reviews.reduce((acc, review) => acc + review.rating, 0) / reviews.length
      : 0;

    res.json({
      id: booking.id,
      roomId: booking.room_id,
      roomName: booking.room.title,
      roomImage: booking.room.room_images.find(img => img.is_primary)?.url || 
                (booking.room.room_images[0]?.url || null),
      startDate: booking.start_date,
      endDate: booking.end_date,
      price: booking.price,
      status: booking.status,
      createdAt: booking.created_at,
      room: {
        ...booking.room,
        images: booking.room.room_images.map(img => img.url),
        host: booking.room.host,
        reviews: {
          average: averageRating,
          count: reviews.length,
          items: reviews.map(review => ({
            id: review.id,
            user: {
              id: review.user.id,
              name: review.user.name,
              image: review.user.profileImage
            },
            rating: review.rating,
            comment: review.comment,
            date: review.created_at
          }))
        }
      }
    });
  } catch (error) {
    console.error('Error al obtener detalles de la reserva:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/bookings/:id/cancel
router.put('/:id/cancel', authenticateUser, async (req, res) => {
  try {
    const { id } = req.params;

    // Verificar que la reserva existe y pertenece al usuario
    const { data: booking, error: checkError } = await req.supabase
      .from('bookings')
      .select('id, status')
      .eq('id', id)
      .eq('user_id', req.user.id)
      .single();

    if (checkError || !booking) {
      return res.status(404).json({ error: 'Reserva no encontrada' });
    }

    if (booking.status !== 'active') {
      return res.status(400).json({ error: 'Solo se pueden cancelar reservas activas' });
    }

    // Cancelar la reserva
    const { error: updateError } = await req.supabase
      .from('bookings')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({ success: true });
  } catch (error) {
    console.error('Error al cancelar la reserva:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router; 