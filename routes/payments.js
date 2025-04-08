const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Crear una sesión de pago
router.post('/create-payment-intent', async (req, res) => {
    try {
        const { amount, currency = 'mxn' } = req.body;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount * 100, // Stripe usa centavos
            currency: currency,
            automatic_payment_methods: {
                enabled: true,
            },
        });

        res.json({
            clientSecret: paymentIntent.client_secret,
        });
    } catch (error) {
        console.error('Error al crear el pago:', error);
        res.status(500).json({ error: 'Error al procesar el pago' });
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
        case 'payment_intent.succeeded':
            const paymentIntent = event.data.object;
            console.log('Pago exitoso:', paymentIntent.id);
            // Aquí puedes agregar lógica para actualizar tu base de datos
            break;
        case 'payment_intent.payment_failed':
            const failedPayment = event.data.object;
            console.log('Pago fallido:', failedPayment.id);
            break;
    }

    res.json({ received: true });
});

module.exports = router; 