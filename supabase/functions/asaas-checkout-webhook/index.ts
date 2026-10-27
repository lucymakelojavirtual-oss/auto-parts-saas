import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)
  const expectedToken = Deno.env.get('ASAAS_WEBHOOK_TOKEN')
  const receivedToken = request.headers.get('asaas-access-token')
  if (!expectedToken || !receivedToken || receivedToken !== expectedToken) {
    return jsonResponse({ error: 'Unauthorized webhook' }, 401)
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Asaas webhook service is not fully configured')
    }

    const body = await request.json()
    const eventId = typeof body.id === 'string' ? body.id : ''
    const eventType = typeof body.event === 'string' ? body.event : ''
    const checkout = body.checkout && typeof body.checkout === 'object'
      ? body.checkout as { id?: unknown; externalReference?: unknown }
      : null
    const checkoutId = typeof checkout?.id === 'string' ? checkout.id : ''
    const orderId = typeof checkout?.externalReference === 'string' ? checkout.externalReference : ''
    if (!eventId || !checkoutId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return jsonResponse({ error: 'Invalid Asaas Checkout event payload' }, 400)
    }
    if (!['CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED'].includes(eventType)) {
      return jsonResponse({ received: true, ignored: true })
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error: eventError } = await admin.rpc('process_asaas_checkout_event', {
      p_event_id: eventId,
      p_event_type: eventType,
      p_order_id: orderId,
      p_checkout_id: checkoutId,
    })
    if (eventError) throw eventError
    return jsonResponse({ received: true })
  } catch (error) {
    console.error('Asaas Checkout webhook failed', error)
    return jsonResponse({ error: 'Unable to process Asaas Checkout event' }, 500)
  }
})
