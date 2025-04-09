const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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
            success_url: successUrl || `${process.env.FRONTEND_URL}/success`,
            cancel_url: cancelUrl || `${process.env.FRONTEND_URL}/cancel`,
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