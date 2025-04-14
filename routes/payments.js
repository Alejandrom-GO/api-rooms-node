const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { supabase } = require('../lib/supabase');

// URLs por defecto
const DEFAULT_FRONTEND_URL = 'https://app-rooms-git-main-alejandromgos-projects.vercel.app/';  // URL de producción sin git-main
const DEFAULT_API_URL = 'https://api-rooms-node.vercel.app/api';   // URL de producción sin git-main

// Crear una sesión de Checkout
router.post('/create-checkout-session', async (req, res) => {
    try {
        const { 
            amount, 
            currency = 'mxn', 
            successUrl, 
            cancelUrl,
            roomDetails = {
                name: 'Habitación Estándar',
                checkIn: '2024-04-10',
                checkOut: '2024-04-12',
                guests: 2
            }
        } = req.body;

        // Validar que amount sea un número válido
        if (!amount || isNaN(amount) || amount <= 0) {
            return res.status(400).json({ 
                error: 'El monto debe ser un número válido mayor a 0',
                receivedAmount: amount
            });
        }

        // URLs por defecto si no se proporcionan
        const defaultSuccessUrl = process.env.APP_TYPE === 'tauri' 
            ? `api-rooms://payment-handler/{CHECKOUT_SESSION_ID}`
            : successUrl || 
              (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payment-handler/{CHECKOUT_SESSION_ID}` : 
              `${DEFAULT_FRONTEND_URL}/payment-handler/{CHECKOUT_SESSION_ID}`);
            
        const defaultCancelUrl = process.env.APP_TYPE === 'tauri'
            ? `api-rooms://confirm-booking-view/${roomDetails.roomId}`
            : cancelUrl || 
              (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payment-handler/cancel` : 
              `${DEFAULT_FRONTEND_URL}/payment-handler/cancel`);

        // Asegurarnos de que la URL de éxito no incluya parámetros de autenticación de Vercel
        const cleanSuccessUrl = defaultSuccessUrl.split('?')[0];
        const cleanCancelUrl = defaultCancelUrl.split('?')[0];

        console.log('URL de éxito configurada:', cleanSuccessUrl);

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: currency,
                        product_data: {
                            name: roomDetails.name,
                            description: `Check-in: ${roomDetails.checkIn}\nCheck-out: ${roomDetails.checkOut}\nHuéspedes: ${roomDetails.guests}`,
                            images: ['https://images.unsplash.com/photo-1566665797739-1674de7a421a?ixlib=rb-4.0.3'],
                        },
                        unit_amount: Math.round(amount * 100),
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: cleanSuccessUrl,
            cancel_url: cleanCancelUrl,
            locale: 'es',
            customer_email: req.body.email,
            metadata: {
                room_id: roomDetails.roomId,
                check_in: roomDetails.checkIn,
                check_out: roomDetails.checkOut,
                guests: roomDetails.guests,
                success_url: cleanSuccessUrl
            }
        });

        console.log('URL de éxito configurada:', cleanSuccessUrl);
        console.log('URL de éxito en la sesión:', session.success_url);
        console.log('URL de cancelación configurada:', cleanCancelUrl);
        console.log('URL de cancelación en la sesión:', session.cancel_url);

        res.json({ url: session.url });
    } catch (error) {
        console.error('Error al crear la sesión de checkout:', error);
        res.status(500).json({ 
            error: 'Error al procesar el pago',
            details: error.message
        });
    }
});

// Ruta para verificar el estado del pago
router.get('/check-session/:sessionId', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        res.json({
            status: session.payment_status,
            customer: session.customer,
            amount: session.amount_total,
            metadata: session.metadata
        });
    } catch (error) {
        console.error('Error al verificar la sesión:', error);
        res.status(500).json({ 
            error: 'Error al verificar el estado del pago',
            details: error.message
        });
    }
});

// Webhook para manejar eventos de Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Error en webhook:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Manejar eventos específicos
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Pago exitoso:', session.id);
            
            try {
                // Obtener los metadatos de la sesión
                const { room_id, check_in, check_out, guests } = session.metadata;
                
                // Obtener el usuario por el email del cliente
                const { data: userData, error: userError } = await supabase
                    .from('users')
                    .select('id')
                    .eq('email', session.customer_email)
                    .single();

                if (userError) {
                    console.error('Error al obtener usuario:', userError);
                    return res.status(500).json({ error: 'Error al procesar la reservación' });
                }

                // Verificar que la habitación existe y obtener su precio
                const { data: room, error: roomError } = await supabase
                    .from('rooms')
                    .select('price')
                    .eq('id', room_id)
                    .single();

                if (roomError || !room) {
                    console.error('Error al obtener habitación:', roomError);
                    return res.status(404).json({ error: 'Habitación no encontrada' });
                }

                // Crear la reservación en la base de datos
                const { data: booking, error: bookingError } = await supabase
                    .from('bookings')
                    .insert([
                        {
                            user_id: userData.id,
                            room_id: room_id,
                            start_date: check_in,
                            end_date: check_out,
                            guests: parseInt(guests),
                            price: session.amount_total / 100, // Convertir de centavos a la unidad monetaria
                            status: 'active',
                            payment_session_id: session.id,
                            payment_status: 'paid'
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

                if (bookingError) {
                    console.error('Error al crear reservación:', bookingError);
                    return res.status(500).json({ error: 'Error al crear la reservación' });
                }

                // Actualizar contador de reservas en user_stats
                const { error: statsError } = await supabase
                    .from('user_stats')
                    .update({ bookings: supabase.raw('bookings + 1') })
                    .eq('user_id', userData.id);

                if (statsError) {
                    console.error('Error al actualizar estadísticas:', statsError);
                }

                console.log('Reservación creada exitosamente:', {
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
                console.error('Error al procesar el pago exitoso:', error);
                return res.status(500).json({ error: 'Error al procesar el pago' });
            }
            break;
        case 'checkout.session.expired':
            const expiredSession = event.data.object;
            console.log('Sesión expirada:', expiredSession.id);
            break;
    }

    res.json({ received: true });
});

// Endpoint para verificar el estado de un pago
router.get('/verify-payment/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        if (!sessionId) {
            return res.status(400).json({ 
                error: 'Se requiere el ID de la sesión de pago',
                success: false
            });
        }

        // Obtener la sesión de Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        
        // Verificar el estado del pago
        const paymentStatus = {
            id: session.id,
            status: session.payment_status,
            amount: session.amount_total / 100, // Convertir de centavos a la unidad monetaria
            currency: session.currency,
            customer: session.customer,
            metadata: session.metadata,
            created: new Date(session.created * 1000).toISOString(),
            success: session.payment_status === 'paid'
        };

        res.json(paymentStatus);
    } catch (error) {
        console.error('Error al verificar el pago:', error);
        res.status(500).json({ 
            error: 'Error al verificar el estado del pago',
            details: error.message,
            success: false
        });
    }
});

module.exports = router; 