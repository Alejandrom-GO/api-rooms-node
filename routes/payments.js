const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// URLs por defecto
const DEFAULT_FRONTEND_URL = 'https://app-rooms-git-main-alejandromgos-projects.vercel.app';
const DEFAULT_API_URL = 'https://api-rooms-node-git-main-alejandromgos-projects.vercel.app/api';

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
        const defaultSuccessUrl = successUrl || 
            (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payment-handler/{CHECKOUT_SESSION_ID}` : 
            `${DEFAULT_FRONTEND_URL}/payment-handler/{CHECKOUT_SESSION_ID}`);
            
        const defaultCancelUrl = cancelUrl || 
            (process.env.FRONTEND_URL ? `${process.env.FRONTEND_URL}/payment-handler/cancel` : 
            `${DEFAULT_FRONTEND_URL}/payment-handler/cancel`);

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
            success_url: defaultSuccessUrl,
            cancel_url: defaultCancelUrl,
            locale: 'es',
            customer_email: req.body.email,
            metadata: {
                room_id: roomDetails.roomId,
                check_in: roomDetails.checkIn,
                check_out: roomDetails.checkOut,
                guests: roomDetails.guests
            }
        });

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
            // Aquí puedes agregar lógica para actualizar tu base de datos
            break;
        case 'checkout.session.expired':
            const expiredSession = event.data.object;
            console.log('Sesión expirada:', expiredSession.id);
            break;
    }

    res.json({ received: true });
});

module.exports = router; 