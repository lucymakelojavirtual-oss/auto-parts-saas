import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type CheckoutOrder = {
  id: string
  tenant_id: string
  customer_id: string
  order_number: number
  subtotal: number
  shipping_amount: number
  total: number
  is_pickup: boolean
  delivery_address: Record<string, string> | null
  payment_status: string
  stock_released_at: string | null
  asaas_checkout_id: string | null
  asaas_checkout_url: string | null
  payment_method: 'pix' | 'card'
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function asaasApiUrl(environment: string) {
  if (environment === 'sandbox') return 'https://api-sandbox.asaas.com/v3'
  if (environment === 'production') return 'https://api.asaas.com/v3'
  throw new Error('ASAAS_ENVIRONMENT must be set to sandbox or production')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    const asaasApiKey = Deno.env.get('ASAAS_API_KEY')
    const appBaseUrl = Deno.env.get('APP_BASE_URL')?.replace(/\/+$/, '')
    const apiUrl = asaasApiUrl(Deno.env.get('ASAAS_ENVIRONMENT') ?? '')
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !asaasApiKey || !appBaseUrl) {
      throw new Error('Asaas checkout service is not fully configured')
    }
    const appUrl = new URL(appBaseUrl)
    if (appUrl.protocol !== 'https:' && appUrl.hostname !== 'localhost') {
      throw new Error('APP_BASE_URL must use HTTPS')
    }

    const authorization = request.headers.get('Authorization') ?? ''
    const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]
    if (!token) return jsonResponse({ error: 'Customer sign-in required' }, 401)

    const userClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser(token)
    if (userError || !userData.user) return jsonResponse({ error: 'Customer session is invalid' }, 401)

    const body = await request.json()
    const orderId = typeof body.order_id === 'string' ? body.order_id : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId)) {
      return jsonResponse({ error: 'A valid order is required' }, 400)
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: orderData, error: orderError } = await admin.from('orders')
      .select('id, tenant_id, customer_id, order_number, subtotal, shipping_amount, total, is_pickup, delivery_address, payment_status, stock_released_at, asaas_checkout_id, asaas_checkout_url, payment_method')
      .eq('id', orderId)
      .maybeSingle()
    if (orderError) throw orderError
    const order = orderData as CheckoutOrder | null
    if (!order || order.customer_id !== userData.user.id) {
      return jsonResponse({ error: 'Order was not found for this customer' }, 404)
    }
    if (order.payment_status !== 'pending' || order.stock_released_at) {
      return jsonResponse({ error: 'This order is no longer available for payment' }, 409)
    }
    if (order.asaas_checkout_id && order.asaas_checkout_url) {
      return jsonResponse({ checkout_url: order.asaas_checkout_url })
    }

    const [{ data: profile, error: profileError }, { data: tenant, error: tenantError },
      { data: account, error: accountError }, { data: subscription, error: subscriptionError },
      { data: items, error: itemsError }] = await Promise.all([
      admin.from('customer_profiles').select('full_name, document, phone, street, address_number, complement, district, postal_code').eq('user_id', order.customer_id).maybeSingle(),
      admin.from('tenants').select('name, slug, status').eq('id', order.tenant_id).maybeSingle(),
      admin.from('tenant_payment_accounts').select('asaas_wallet_id').eq('tenant_id', order.tenant_id).maybeSingle(),
      admin.from('subscriptions').select('plans(commission_rate)').eq('tenant_id', order.tenant_id).in('status', ['trial', 'active']).maybeSingle(),
      admin.from('order_items').select('product_name, quantity, unit_price').eq('order_id', order.id),
    ])
    if (profileError) throw profileError
    if (tenantError) throw tenantError
    if (accountError) throw accountError
    if (subscriptionError) throw subscriptionError
    if (itemsError) throw itemsError
    if (!profile || !tenant || tenant.status !== 'active' || !account?.asaas_wallet_id
      || !subscription?.plans || !items?.length) {
      return jsonResponse({ error: 'Store payment account or customer checkout data is not configured' }, 422)
    }

    const commissionRate = Number((subscription.plans as { commission_rate: number }).commission_rate)
    const subtotal = Number(order.subtotal)
    const shippingAmount = Number(order.shipping_amount)
    const total = Number(order.total)
    if (!Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 1
      || !Number.isFinite(total) || total <= 0 || Math.abs(total - subtotal - shippingAmount) > 0.01) {
      throw new Error('Order totals or commission configuration are invalid')
    }
    const platformShare = total > 0 ? (commissionRate * subtotal / total) * 100 : 0
    const storeShare = 100 - platformShare
    if (storeShare <= 0 || storeShare > 100) {
      throw new Error('The store split is invalid')
    }
    const checkoutItems = items.map((item) => ({
      imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
      name: String(item.product_name).slice(0, 30),
      description: `Pedido ${order.order_number}`,
      quantity: Number(item.quantity),
      value: Number(item.unit_price),
    }))
    if (shippingAmount > 0) {
      checkoutItems.push({
        imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l2cAAAAASUVORK5CYII=',
        name: 'Frete',
        description: 'Entrega do pedido',
        quantity: 1,
        value: shippingAmount,
      })
    }
    const callbackBase = `${appBaseUrl}/cliente?pedido=${encodeURIComponent(order.id)}`
    const checkoutPayload = {
      billingTypes: [order.payment_method === 'pix' ? 'PIX' : 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 1440,
      externalReference: order.id,
      callback: {
        successUrl: `${callbackBase}&retorno=sucesso`,
        cancelUrl: `${callbackBase}&retorno=cancelado`,
        expiredUrl: `${callbackBase}&retorno=expirado`,
      },
      customerData: {
        name: profile.full_name,
        cpfCnpj: profile.document,
        email: userData.user.email,
        phone: profile.phone,
        address: order.delivery_address?.street ?? profile.street,
        addressNumber: order.delivery_address?.number ?? profile.address_number ?? undefined,
        complement: order.delivery_address?.complement ?? profile.complement,
        province: order.delivery_address?.district ?? profile.district,
        postalCode: order.delivery_address?.postal_code ?? profile.postal_code,
      },
      items: checkoutItems,
      splits: [{
        walletId: account.asaas_wallet_id,
        percentualValue: Number(storeShare.toFixed(4)),
      }],
    }

    const asaasResponse = await fetch(`${apiUrl}/checkouts`, {
      method: 'POST',
      headers: { access_token: asaasApiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(checkoutPayload),
    })
    const asaasResult: unknown = await asaasResponse.json()
    if (!asaasResponse.ok || !asaasResult || typeof asaasResult !== 'object') {
      const details = asaasResult as { errors?: { description?: string }[] } | null
      console.error('Asaas checkout creation failed', asaasResponse.status, details?.errors)
      return jsonResponse({ error: details?.errors?.[0]?.description ?? 'Asaas could not create the payment checkout' }, 502)
    }
    const checkout = asaasResult as { id?: unknown; link?: unknown }
    if (typeof checkout.id !== 'string' || typeof checkout.link !== 'string'
      || !checkout.link.startsWith('https://')) {
      throw new Error('Asaas returned an invalid checkout response')
    }

    const { error: saveError } = await admin.rpc('update_storefront_order_checkout', {
      p_order_id: order.id,
      p_checkout_id: checkout.id,
      p_checkout_url: checkout.link,
    })
    if (saveError) {
      console.error('Unable to persist Asaas checkout', order.id, saveError.message)
      return jsonResponse({ error: 'The payment session was created but could not be linked to the order. Contact the store before retrying.' }, 502)
    }
    return jsonResponse({ checkout_url: checkout.link })
  } catch (error) {
    console.error('Asaas checkout failed', error)
    return jsonResponse({ error: error instanceof Error ? error.message : 'Unable to create payment checkout' }, 500)
  }
})
