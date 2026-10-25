import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, Bike, ChartNoAxesCombined, Clock3, LifeBuoy, LockKeyhole, MapPinned, MessageCircle, Package, Palette, PanelsTopLeft, RefreshCw, Send, ShoppingCart, Store, Trash2, Upload, Wallet, X } from 'lucide-react'
import { requireSupabase } from './services/supabase'

const RouteMap = lazy(() => import('./components/RouteMap'))

type Plan = {
  id: string
  name: string
  monthly_price: number
  commission_rate: number
  max_products: number
  monthly_nfe_limit: number
  max_sellers: number
  max_couriers: number
}
type Membership = { tenant_id: string; role: string }
type Portal = {
  tenantId: string
  tenantName: string
  role: string
  slug: string
  logoUrl: string | null
  brand: { app_name?: string; primary_color?: string; tagline?: string; promotional_banners?: string[] }
}
type CatalogProduct = {
  id: string
  sku: string
  name: string
  description: string | null
  price: number
  stock: number
  image_url: string | null
  is_published: boolean
}
type TenantCreditStatus = {
  period_start: string
  period_end: string
  plates: { monthly_limit: number; monthly_used: number; addon_balance: number }
  nfe: { monthly_limit: number; monthly_used: number; addon_balance: number }
}
type DeliveryQuote = {
  distance_meters: number
  duration_seconds: number
  distance_km: number
  geometry: { type: 'LineString'; coordinates: [number, number][] }
  shipping_amount: number
  cache_hit: boolean
}
type Conversation = { id: string; tenant_id: string; subject: string; status: string; created_at: string }
type SupportMessage = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }
type MasterStoreMetrics = {
  id: string
  name: string
  slug: string
  status: string
  created_at: string
  plan_name: string | null
  monthly_price: number | null
  commission_rate: number | null
  subscription_status: string | null
  current_period_end: string | null
  monthly_paid_sales: number
  monthly_paid_orders: number
  monthly_delivered: number
  monthly_delivery_fees: number
  monthly_route_fee_estimate: number
  monthly_average_distance_km: number | null
  monthly_split_amount: number
  monthly_split_count: number
  monthly_split_settled: number
}
type MasterDashboardData = {
  generated_at: string
  stores: MasterStoreMetrics[]
  plate_lookups: {
    daily: number; weekly: number; monthly: number; yearly: number
    daily_api: number; weekly_api: number; monthly_api: number; yearly_api: number
    monthly_api_cost: number; monthly_cache_fee_estimate: number
  }
  monthly_trend: {
    month: string
    split_revenue: number
    settled_split_revenue: number
    renewals_forecast: number
    renewals_forecast_amount: number
  }[]
}

const money = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const TERMS_VERSION = '2026-10-23-v1'
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'vancelysoftware@gmail.com'
const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || '5592920021316'
const BRAND_COLOR_SWATCHES = ['#293125', '#587523', '#718c28', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0f766e']

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado. Tente novamente.'
}

function monthDisplayDate(value: string) {
  const [year, month] = value.slice(0, 7).split('-').map(Number)
  return new Date(year, month - 1, 15, 12)
}

function convertImageToWebP(file: File, maxDimension = 800, quality = 0.88): Promise<Blob> {
  return createImageBitmap(file).then((image) => {
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      image.close()
      throw new Error('Não foi possível preparar a imagem.')
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    image.close()
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Não foi possível converter a logomarca para WebP.'))
      }, 'image/webp', quality)
    })
  })
}

function isAdminUser(user: User) {
  return user.app_metadata?.role === 'admin_master' || user.app_metadata?.role === 'vancely_admin'
}

function navigate(path: string) {
  window.location.assign(path)
}

async function resolvePortal(user: User): Promise<Portal> {
  const client = requireSupabase()
  const { data: membership, error } = await client
    .from('tenant_members')
    .select('tenant_id, role')
    .eq('user_id', user.id)
    .limit(1)
    .maybeSingle()

  if (error) throw error

  let member = membership as Membership | null
  if (!member) {
    const { error: registrationError } = await client.rpc('complete_tenant_registration')
    if (registrationError) {
      throw new Error('Esta conta ainda não está vinculada a uma loja. Conclua o cadastro ou fale com o suporte.')
    }
    const { data, error: reloadError } = await client
      .from('tenant_members')
      .select('tenant_id, role')
      .eq('user_id', user.id)
      .limit(1)
      .maybeSingle()
    if (reloadError) throw reloadError
    member = data as Membership | null
  }

  if (!member) throw new Error('Não foi possível localizar o acesso da sua loja.')
  const { data: tenant, error: tenantError } = await client
    .from('tenants')
    .select('name, slug, logo_url, brand')
    .eq('id', member.tenant_id)
    .maybeSingle()
  if (tenantError) throw tenantError
  if (!tenant) throw new Error('A loja vinculada a esta conta não está disponível.')
  return {
    tenantId: member.tenant_id,
    tenantName: String(tenant.name),
    slug: String(tenant.slug),
    role: member.role,
    logoUrl: typeof tenant.logo_url === 'string' ? tenant.logo_url : null,
    brand: (tenant.brand ?? {}) as Portal['brand'],
  }
}

async function resolveMasterPortal(slug: string): Promise<Portal> {
  const { data, error } = await requireSupabase().rpc('get_master_tenant_by_slug', { p_slug: slug })
  if (error) throw error
  const tenant = (data?.[0] as {
    id: string
    name: string
    slug: string
    logo_url: string | null
    brand: Portal['brand']
  } | undefined)
  if (!tenant) throw new Error('A loja solicitada não foi encontrada.')
  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    slug: tenant.slug,
    role: 'admin_master',
    logoUrl: tenant.logo_url,
    brand: tenant.brand ?? {},
  }
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/registrar') return <RegistrationPage />
  if (path === '/login') return <LoginPage kind="merchant" />
  if (path === '/admin/login') return <LoginPage kind="admin" />
  const storefrontMatch = path.match(/^\/loja\/([^/]+)$/)
  if (storefrontMatch) return <StorefrontPage slug={decodeURIComponent(storefrontMatch[1])} />
  const masterStoreViewMatch = path.match(/^\/(app|driver)\/([^/]+)$/)
  if (path === '/admin' || path === '/app' || path === '/entregador' || masterStoreViewMatch) {
    return <ProtectedPage path={path} />
  }
  return <LandingPage />
}

function LandingPage() {
  return (
    <main className="auth-page">
      <section className="auth-card landing-card">
        <Brand />
        <p className="eyebrow">PLATAFORMA VANCELY</p>
        <h1>Operação conectada para autopeças.</h1>
        <p className="auth-description">Acesse seu ambiente ou cadastre sua loja para começar.</p>
        <div className="landing-actions">
          <a className="auth-button auth-button-primary" href="/login">Entrar na minha loja <ArrowRight size={17} /></a>
          <a className="auth-button auth-button-secondary" href="/registrar">Cadastrar autopeças</a>
          <a className="auth-subtle-link" href="/admin/login">Acesso administrativo</a>
        </div>
      </section>
    </main>
  )
}

function Brand() {
  return <div className="auth-brand"><span className="brand-mark">V</span><span>vancely<span className="brand-light">software</span></span></div>
}

function LoginPage({ kind }: { kind: 'admin' | 'merchant' }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const isAdmin = kind === 'admin'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const client = requireSupabase()
      const { data, error: signInError } = await client.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
      if (isAdmin) {
        if (!isAdminUser(data.user)) {
          setError('Esta conta não tem perfil de administrador Vancely.')
          return
        }
        const next = new URLSearchParams(window.location.search).get('next')
        navigate(next && /^\/(?:app|driver)\/[^/]+$/.test(next) ? next : '/admin')
      } else {
        if (isAdminUser(data.user)) {
          navigate('/admin')
          return
        }
        const portal = await resolvePortal(data.user)
        navigate(portal.role === 'courier' ? '/entregador' : '/app')
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <Brand />
        <a className="auth-back" href="/"><ArrowLeft size={15} /> Voltar</a>
        <p className="eyebrow">{isAdmin ? 'SOFTWARE PAI' : 'ÁREA DA LOJA'}</p>
        <h1>{isAdmin ? 'Acesso administrativo' : 'Entre na sua conta'}</h1>
        <p className="auth-description">{isAdmin ? 'Acesso restrito à equipe autorizada Vancely.' : 'Use seu e-mail e senha cadastrados pela sua autopeças.'}</p>
        <form className="auth-form" onSubmit={submit}>
          <label>E-mail<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Senha<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          <button className="auth-button auth-button-primary" type="submit" disabled={busy}>
            <LockKeyhole size={16} /> {busy ? 'Verificando acesso…' : 'Entrar'}
          </button>
        </form>
        {!isAdmin && <p className="auth-footer">Ainda não tem uma loja? <a href="/registrar">Faça seu cadastro</a></p>}
      </section>
    </main>
  )
}

function RegistrationPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loadingPlans, setLoadingPlans] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [fields, setFields] = useState({
    store_name: '', legal_name: '', cnpj: '', whatsapp: '', street: '', number: '',
    city: '', state: '', postal_code: '', owner_name: '', email: '', password: '', plan_id: '',
  })

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data, error: plansError } = await requireSupabase()
          .from('plans')
          .select('id, name, monthly_price, commission_rate, max_products, monthly_nfe_limit, max_sellers, max_couriers')
          .eq('is_active', true).order('monthly_price')
        if (plansError) throw plansError
        if (active) setPlans((data ?? []) as Plan[])
      } catch (reason) {
        if (active) setError(errorText(reason))
      } finally {
        if (active) setLoadingPlans(false)
      }
    })()
    return () => { active = false }
  }, [])

  function update(field: keyof typeof fields, value: string) {
    setFields((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const client = requireSupabase()
      const onboarding = {
        store_name: fields.store_name.trim(),
        legal_name: fields.legal_name.trim(),
        cnpj: fields.cnpj.replace(/\D/g, ''),
        whatsapp: fields.whatsapp.trim(),
        street: fields.street.trim(),
        number: fields.number.trim(),
        city: fields.city.trim(),
        state: fields.state.trim().toUpperCase(),
        postal_code: fields.postal_code.replace(/\D/g, ''),
        owner_name: fields.owner_name.trim(),
        plan_id: fields.plan_id,
        terms_accepted: termsAccepted,
        terms_version: TERMS_VERSION,
        terms_accepted_at: new Date().toISOString(),
      }
      const { data, error: signUpError } = await client.auth.signUp({
        email: fields.email,
        password: fields.password,
        options: {
          data: { full_name: onboarding.owner_name, vancely_onboarding: onboarding },
        },
      })
      if (signUpError) throw signUpError
      if (!data.user) throw new Error('O Supabase não retornou a conta criada.')
      if (!data.session) {
        setNotice('Conta criada. Confirme seu e-mail e depois entre para concluir a criação da loja.')
        return
      }
      const { error: registrationError } = await client.rpc('complete_tenant_registration')
      if (registrationError) throw registrationError
      navigate('/app')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="auth-page auth-page-scroll">
      <section className="auth-card registration-card">
        <Brand />
        <a className="auth-back" href="/"><ArrowLeft size={15} /> Voltar</a>
        <p className="eyebrow">ONBOARDING</p>
        <h1>Cadastre sua autopeças</h1>
        <p className="auth-description">Seus dados e o acesso da loja serão vinculados após a confirmação da conta.</p>
        <form className="auth-form registration-form" onSubmit={submit}>
          <h2>Dados da loja</h2>
          <label>Nome fantasia<input required value={fields.store_name} onChange={(event) => update('store_name', event.target.value)} /></label>
          <label>Razão social<input required value={fields.legal_name} onChange={(event) => update('legal_name', event.target.value)} /></label>
          <div className="auth-form-row">
            <label>CNPJ<input required inputMode="numeric" minLength={14} maxLength={18} value={fields.cnpj} onChange={(event) => update('cnpj', event.target.value)} /></label>
            <label>WhatsApp<input required type="tel" value={fields.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label>
          </div>
          <div className="auth-form-row">
            <label>CEP<input required inputMode="numeric" value={fields.postal_code} onChange={(event) => update('postal_code', event.target.value)} /></label>
            <label>Rua / Avenida<input required value={fields.street} onChange={(event) => update('street', event.target.value)} /></label>
          </div>
          <div className="auth-form-row">
            <label>Número<input required value={fields.number} onChange={(event) => update('number', event.target.value)} /></label>
            <label>Cidade<input required value={fields.city} onChange={(event) => update('city', event.target.value)} /></label>
            <label>UF<input required minLength={2} maxLength={2} value={fields.state} onChange={(event) => update('state', event.target.value)} /></label>
          </div>
          <h2>Proprietário e acesso</h2>
          <label>Nome do proprietário<input required value={fields.owner_name} onChange={(event) => update('owner_name', event.target.value)} /></label>
          <label>E-mail de acesso<input required type="email" autoComplete="email" value={fields.email} onChange={(event) => update('email', event.target.value)} /></label>
          <label>Senha (mínimo de 8 caracteres)<input required type="password" minLength={8} autoComplete="new-password" value={fields.password} onChange={(event) => update('password', event.target.value)} /></label>
          <h2>Plano SaaS</h2>
          <label>Plano
            <select required value={fields.plan_id} onChange={(event) => update('plan_id', event.target.value)} disabled={loadingPlans || plans.length === 0}>
              <option value="">{loadingPlans ? 'Carregando planos…' : 'Selecione um plano'}</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>
                {plan.name} · {money(plan.monthly_price)}/mês · {Number(plan.commission_rate) * 100}% comissão · {plan.max_products.toLocaleString('pt-BR')} produtos · {plan.monthly_nfe_limit.toLocaleString('pt-BR')} NF-e
              </option>)}
            </select>
          </label>
          {!loadingPlans && plans.length === 0 && <p className="form-message">Nenhum plano ativo foi configurado no Supabase. A equipe Vancely precisa cadastrar Essencial, Aceleração e Sede para liberar o cadastro.</p>}
          <details className="terms-details">
            <summary>Leia os Termos de Uso, Licenciamento e Cancelamento (versão {TERMS_VERSION})</summary>
            <article className="terms-content">
              <p><b>CONTRATADA:</b> VANCELY SOFTWARE, sob a responsabilidade de VANCELY SOFTWARE (Pessoa Física/Empresário Individual - CPF: 018.339.682-04), com suporte pelo e-mail <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> e telefone/WhatsApp <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer">(92) 92002-1316</a>.</p>
              <p><b>CONTRATANTE:</b> A Pessoa Física ou Jurídica (Dono da Auto Peças) devidamente cadastrada na plataforma Vancely Software.</p>
              <h3>1. Do objeto</h3>
              <p>1.1 O presente contrato concede ao CONTRATANTE uma licença de uso limitada, não exclusiva, intransferível e revogável da plataforma "Vancely Software" (Software como Serviço - SaaS), para gestão de vendas, vitrine B2C, controle de catálogo e gestão de entregas de autopeças.</p>
              <h3>2. Do direito de arrependimento e política de cancelamento (7 dias)</h3>
              <p>2.1 Conforme o Artigo 49 do Código de Defesa do Consumidor (Lei nº 8.078/1990), o CONTRATANTE poderá solicitar o cancelamento da assinatura e o reembolso integral do valor pago no prazo de até 7 (sete) dias corridos a contar da data de assinatura/contratação do plano.</p>
              <p>2.2 Para solicitar o cancelamento com reembolso em até 7 dias, o CONTRATANTE deverá enviar uma solicitação formal via e-mail para <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> ou pelo canal oficial de suporte via WhatsApp <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer">(92) 92002-1316</a>.</p>
              <p>2.3 Após o prazo de 7 (sete) dias, a assinatura poderá ser cancelada a qualquer momento através do painel de controle, porém sem restituição proporcional de valores referentes à mensalidade vigente (modelo de renovação recorrente por ciclo).</p>
              <h3>3. Das responsabilidades fiscais, tributárias e legais do lojista</h3>
              <p>3.1 <b>Isenção de Responsabilidade Fiscal da CONTRATADA:</b> A Vancely Software disponibiliza ferramentas e integrações tecnológicas (incluindo emissão via Focus NFe e consultas de dados). Contudo, a CONTRATADA <b>NÃO</b> se responsabiliza pelas obrigações tributárias, fiscais, trabalhistas ou emissão incorreta de documentos fiscais por parte do CONTRATANTE.</p>
              <p>3.2 Toda e qualquer responsabilidade pelo recolhimento de impostos, veracidade das alíquotas (NCM, ICMS, PIS/COFINS), tributação sobre autopeças e cumprimento da legislação fiscal vigente é exclusivamente do <b>CONTRATANTE (Dono da Auto Peças)</b>.</p>
              <p>3.3 O CONTRATANTE declara ter ciência e se responsabiliza integralmente pelas garantias, trocas, devoluções e atendimento pós-venda em conformidade com o Código de Defesa do Consumidor perante os seus Clientes Finais (compradores das peças).</p>
              <h3>4. Das micro-taxas de infraestrutura e reuso de cache (R$ 0,03)</h3>
              <p>4.1 O CONTRATANTE declara ciência de que o reuso de dados de veículos/placas salvos no banco de dados centralizado após a perda do cache local do dispositivo do cliente estará sujeito à taxa de recuperação de infraestrutura de <b>R$ 0,03 (três centavos)</b> por consulta realizada no banco de dados, sendo contabilizado em fatura/extrato de uso.</p>
              <h3>5. Privacidade e proteção de dados (LGPD)</h3>
              <p>5.1 A Vancely Software atua em conformidade com a Lei Geral de Proteção de Dados (Lei nº 13.709/2018), tratando os dados dos clientes finais exclusivamente para o cumprimento da prestação de serviços do software.</p>
            </article>
          </details>
          <label className="auth-checkbox">
            <input type="checkbox" required checked={termsAccepted} onChange={(event) => setTermsAccepted(event.target.checked)} />
            <span>Li e aceito os Termos de Uso, Licenciamento de Software e Política de Cancelamento de 7 dias acima.</span>
          </label>
          <p className="legal-notice">O aceite será associado à versão {TERMS_VERSION}. Recomendamos revisão jurídica do texto antes de iniciar a operação comercial.</p>
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {notice && <p className="form-message" role="status">{notice} <a href="/login">Ir para login</a></p>}
          <button className="auth-button auth-button-primary" type="submit" disabled={busy || loadingPlans || plans.length === 0}>
            {busy ? 'Criando acesso…' : 'Criar conta e loja'} <ArrowRight size={17} />
          </button>
        </form>
        <p className="auth-footer">Já tem acesso? <a href="/login">Entrar</a></p>
      </section>
    </main>
  )
}

function ProtectedPage({ path }: { path: string }) {
  const [user, setUser] = useState<User | null>(null)
  const [portal, setPortal] = useState<Portal | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const client = requireSupabase()
        const { data: sessionData, error: sessionError } = await client.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session) {
          const masterStoreView = /^\/(?:app|driver)\/[^/]+$/.test(path)
          navigate(masterStoreView
            ? `/admin/login?next=${encodeURIComponent(path)}`
            : path === '/admin' ? '/admin/login' : '/login')
          return
        }
        const { data, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        if (!data.user) {
          navigate(path === '/admin' ? '/admin/login' : '/login')
          return
        }
        const masterViewMatch = path.match(/^\/(app|driver)\/([^/]+)$/)
        if (masterViewMatch) {
          if (!isAdminUser(data.user)) {
            setError('A visualização direta de lojas é restrita ao Admin Master.')
            return
          }
          const currentPortal = await resolveMasterPortal(decodeURIComponent(masterViewMatch[2]))
          setUser(data.user)
          setPortal(currentPortal)
          return
        }
        if (path === '/admin') {
          if (!isAdminUser(data.user)) {
            setError('Acesso restrito à equipe administrativa Vancely.')
            return
          }
          setUser(data.user)
          return
        }
        if (isAdminUser(data.user)) {
          navigate('/admin')
          return
        }
        const currentPortal = await resolvePortal(data.user)
        if (path === '/entregador' && currentPortal.role !== 'courier') {
          navigate('/app')
          return
        }
        if (path === '/app' && currentPortal.role === 'courier') {
          navigate('/entregador')
          return
        }
        setUser(data.user)
        setPortal(currentPortal)
      } catch (reason) {
        if (active) setError(errorText(reason))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [path])

  async function logout() {
    const { error: logoutError } = await requireSupabase().auth.signOut()
    if (logoutError) {
      setError(logoutError.message)
      return
    }
    navigate(path === '/admin' ? '/admin/login' : '/login')
  }

  if (loading) return <PageMessage title="Verificando acesso…" />
  if (error) return <PageMessage title="Acesso indisponível" message={error} link={path === '/admin' ? '/admin/login' : '/login'} linkText="Ir para login" />
  if (path === '/admin' && user) return <AdminDashboard user={user} onLogout={logout} />
  if (!portal || !user) return <PageMessage title="Acesso indisponível" message="Não encontramos um perfil associado a esta conta." link="/login" linkText="Ir para login" />
  const masterPreview = isAdminUser(user) && /^\/(?:app|driver)\//.test(path)
  if (path === '/entregador' || path.startsWith('/driver/')) {
    return <CourierPortal user={user} portal={portal} onLogout={logout} masterPreview={masterPreview} />
  }
  return <MerchantPortal user={user} portal={portal} onLogout={logout} masterPreview={masterPreview} />
}

function PageMessage({ title, message, link, linkText }: { title: string; message?: string; link?: string; linkText?: string }) {
  return <main className="auth-page"><section className="auth-card"><Brand /><h1>{title}</h1>{message && <p className="auth-description">{message}</p>}{link && <a className="auth-button auth-button-primary" href={link}>{linkText ?? 'Continuar'}</a>}</section></main>
}

function MerchantPortal({ user, portal, onLogout, masterPreview = false }: { user: User; portal: Portal; onLogout: () => void; masterPreview?: boolean }) {
  const [supportOpen, setSupportOpen] = useState(false)
  const isStoreTeam = portal.role !== 'courier'
  const canManageSettings = masterPreview || ['owner', 'admin', 'manager'].includes(portal.role)
  return (
    <main className="portal-page">
      {masterPreview && <MasterViewingBanner tenantName={portal.tenantName} />}
      <PortalHeader user={user} title={portal.tenantName} onLogout={onLogout} />
      <section className="portal-content" style={{ '--store-color': portal.brand.primary_color ?? '#293125' } as React.CSSProperties}>
        <p className="eyebrow">AMBIENTE DA LOJA · {portal.role.toUpperCase()}</p>
        <h1>Bem-vindo à {portal.tenantName}</h1>
        <p className="auth-description">{masterPreview ? 'Sessão Admin Master com visualização e gestão autorizadas desta loja.' : 'O acesso está autenticado e isolado para esta loja.'} Catálogo, frete e saldos são exibidos conforme seu perfil; integrações operacionais dependem das APIs de produção.</p>
        <div className="portal-cards">
          <article><Store size={20} /><h2>Dados da loja</h2>{portal.logoUrl && <img className="tenant-logo-preview" src={portal.logoUrl} alt={`Logomarca ${portal.tenantName}`} />}<p>Vitrine: <a href={`/loja/${portal.slug}`} target="_blank" rel="noreferrer">/loja/{portal.slug}</a></p></article>
          <article><LifeBuoy size={20} /><h2>Suporte</h2><p>Triagem inicial e atendimento humano pela central Vancely.</p><button className="auth-button auth-button-secondary" onClick={() => setSupportOpen(true)}>Abrir suporte</button></article>
          <article><LockKeyhole size={20} /><h2>Integrações</h2><p>Catálogo, pedidos, faturamento e entregas aguardam configuração das APIs correspondentes.</p></article>
        </div>
        <section className="portal-panel">
          <div className="portal-panel-heading"><div><p className="eyebrow">APLICATIVOS DA LOJA</p><h2>Experiências PWA</h2></div><span>Disponíveis na estrutura atual</span></div>
          <div className="pwa-links">
            <a href={masterPreview ? `/app/${encodeURIComponent(portal.slug)}` : '/app'}><Store size={17} /><span><b>Lojista + vendedor</b><small>{masterPreview ? `/app/${portal.slug}` : '/app · acesso por perfil'}</small></span></a>
            <a href={masterPreview ? `/driver/${encodeURIComponent(portal.slug)}` : '/entregador'}><Bike size={17} /><span><b>Motoboy</b><small>{masterPreview ? `/driver/${portal.slug}` : '/entregador · acesso por perfil'}</small></span></a>
            <a href={`/loja/${portal.slug}`} target="_blank" rel="noreferrer"><Store size={17} /><span><b>Cliente</b><small>/loja/{portal.slug}</small></span></a>
          </div>
        </section>
        {isStoreTeam && !masterPreview && <ProductCatalogManager portal={portal} role={portal.role} />}
        {isStoreTeam && !masterPreview && <TenantCreditPanel portal={portal} />}
        {canManageSettings && <ShippingSettings portal={portal} readOnly={masterPreview} />}
        {canManageSettings && <TenantBrandSettings portal={portal} readOnly={masterPreview} />}
      </section>
      {supportOpen && <SupportDialog user={user} tenantId={portal.tenantId} onClose={() => setSupportOpen(false)} />}
    </main>
  )
}

function ShippingSettings({ portal, readOnly = false }: { portal: Portal; readOnly?: boolean }) {
  const [freeUntilKm, setFreeUntilKm] = useState('0')
  const [pricePerKm, setPricePerKm] = useState('2.50')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    setNotice('')
    void (async () => {
      try {
        const { data, error: queryError } = await requireSupabase().from('shipping_rules')
          .select('free_until_km, price_per_km').eq('tenant_id', portal.tenantId).maybeSingle()
        if (queryError) throw queryError
        if (active) {
          setFreeUntilKm(String(data?.free_until_km ?? 0))
          setPricePerKm(String(data?.price_per_km ?? 2.5))
        }
      } catch (reason) {
        if (active) setError(errorText(reason))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [portal.tenantId])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const freeDistance = Number(freeUntilKm)
      const rate = Number(pricePerKm)
      if (!freeUntilKm.trim() || !Number.isFinite(freeDistance) || freeDistance < 0 || freeDistance > 30) {
        throw new Error('A faixa de entrega grátis deve estar entre 0 e 30 km.')
      }
      if (!pricePerKm.trim() || !Number.isFinite(rate) || rate < 0 || rate > 99999.99) {
        throw new Error('Informe uma taxa válida entre R$ 0,00 e R$ 99.999,99 por km.')
      }
      const { error: saveError } = await requireSupabase().from('shipping_rules').upsert({
        tenant_id: portal.tenantId,
        free_until_km: freeDistance,
        price_per_km: rate,
      }, { onConflict: 'tenant_id' })
      if (saveError) throw saveError
      setNotice('Configuração de entrega atualizada.')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="portal-panel">
    <div className="portal-panel-heading"><div><p className="eyebrow">ENTREGAS</p><h2><span aria-hidden="true">🛵</span> Configuração de Entrega</h2></div></div>
    <form className="delivery-settings-form" onSubmit={save}>
      <div className="delivery-setting">
        <div className="delivery-setting-heading">
          <label htmlFor="free-until-km">Entrega grátis até (km)</label>
          <output htmlFor="free-until-km-range">{Number(freeUntilKm || 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km</output>
        </div>
        <input
          id="free-until-km-range"
          className="delivery-range"
          type="range"
          min="0"
          max="30"
          step="0.1"
          value={Math.min(30, Math.max(0, Number(freeUntilKm) || 0))}
          onChange={(event) => setFreeUntilKm(event.target.value)}
          aria-label="Ajustar faixa de entrega grátis em quilômetros"
          disabled={readOnly || loading}
        />
        <div className="delivery-range-limits"><span>0 km</span><span>30 km</span></div>
        <input
          id="free-until-km"
          type="number"
          min="0"
          max="30"
          step="0.1"
          required
          value={freeUntilKm}
          onChange={(event) => setFreeUntilKm(event.target.value)}
          disabled={readOnly || loading}
        />
      </div>
      <label className="delivery-setting">Taxa por km adicional (R$)
        <span className="delivery-currency-input"><span aria-hidden="true">R$</span><input type="number" min="0" max="99999.99" step="0.01" inputMode="decimal" required value={pricePerKm} onChange={(event) => setPricePerKm(event.target.value)} disabled={readOnly || loading} /></span>
      </label>
      <p className="image-optimization-note">A cobrança é calculada sobre a distância da rota: km acima da faixa grátis × taxa configurada. A distância precisa vir de um serviço de rotas integrado.</p>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      {!readOnly && <button className="auth-button auth-button-primary" type="submit" disabled={busy || loading}>{busy ? 'Salvando…' : 'Salvar configuração'}</button>}
    </form>
  </section>
}

function TenantCreditPanel({ portal }: { portal: Portal }) {
  const [status, setStatus] = useState<TenantCreditStatus | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data, error: statusError } = await requireSupabase().rpc('tenant_credit_status', { p_tenant_id: portal.tenantId })
        if (statusError) throw statusError
        if (active) setStatus(data as TenantCreditStatus)
      } catch (reason) {
        if (active) setError(errorText(reason))
      }
    })()
    return () => { active = false }
  }, [portal.tenantId])

  return <section className="portal-panel">
    <div className="portal-panel-heading"><div><p className="eyebrow">CONSUMO DO PLANO</p><h2><Wallet size={17} /> Consultas e notas fiscais</h2></div></div>
    {error ? <p className="form-message form-error" role="alert">{error}</p> : status ? <>
      <p className="image-optimization-note">Ciclo atual até {new Date(status.period_end).toLocaleDateString('pt-BR')}. Créditos adicionais de placas são cumulativos; adicionais de NF-e expiram ao fim deste ciclo.</p>
      <div className="credit-summary">
        <article><b>Consultas de placas</b><span>{status.plates.monthly_used} / {status.plates.monthly_limit} da cota mensal</span><small>{status.plates.addon_balance} crédito(s) adicional(is), sem expiração</small></article>
        <article><b>Notas fiscais</b><span>{status.nfe.monthly_used} / {status.nfe.monthly_limit} da cota mensal</span><small>{status.nfe.addon_balance} crédito(s) adicional(is) neste ciclo</small></article>
      </div>
    </> : <p className="auth-description">Carregando saldos…</p>}
  </section>
}

function ProductCatalogManager({ portal, role }: { portal: Portal; role: string }) {
  const canDelete = ['owner', 'admin', 'manager'].includes(role)
  const [products, setProducts] = useState<CatalogProduct[]>([])
  const [editingId, setEditingId] = useState('')
  const [sku, setSku] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [stock, setStock] = useState('0')
  const [published, setPublished] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadProducts() {
    const { data, error: loadError } = await requireSupabase().from('products')
      .select('id, sku, name, description, price, stock, image_url, is_published')
      .eq('tenant_id', portal.tenantId).order('name')
    if (loadError) throw loadError
    setProducts((data ?? []) as CatalogProduct[])
  }

  useEffect(() => {
    let active = true
    void loadProducts().catch((reason) => { if (active) setError(errorText(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [portal.tenantId])

  function editProduct(product: CatalogProduct) {
    setEditingId(product.id)
    setSku(product.sku)
    setName(product.name)
    setDescription(product.description ?? '')
    setPrice(String(product.price))
    setStock(String(product.stock))
    setPublished(product.is_published)
    setImageFile(null)
    setNotice('')
    setError('')
  }

  function clearForm() {
    setEditingId('')
    setSku('')
    setName('')
    setDescription('')
    setPrice('')
    setStock('0')
    setPublished(false)
    setImageFile(null)
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const client = requireSupabase()
      const productId = editingId || crypto.randomUUID()
      const productValues = {
        tenant_id: portal.tenantId,
        sku: sku.trim(),
        name: name.trim(),
        description: description.trim() || null,
        price: Number(price),
        stock: Number(stock),
        is_published: published,
      }
      const saveResult = editingId
        ? await client.from('products').update(productValues).eq('id', productId).eq('tenant_id', portal.tenantId)
        : await client.from('products').insert({ ...productValues, id: productId })
      if (saveResult.error) throw saveResult.error
      if (imageFile) {
        const image = await convertImageToWebP(imageFile)
        const path = `tenants/${portal.tenantId}/products/${productId}.webp`
        const { error: uploadError } = await client.storage.from('tenant-media').upload(path, image, {
          cacheControl: '3600',
          contentType: 'image/webp',
          upsert: true,
        })
        if (uploadError) throw uploadError
        const imageUrl = `${client.storage.from('tenant-media').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
        const { error: imageUpdateError } = await client.from('products')
          .update({ image_url: imageUrl }).eq('id', productId).eq('tenant_id', portal.tenantId)
        if (imageUpdateError) throw imageUpdateError
      }
      await loadProducts()
      clearForm()
      setNotice('Produto salvo com sucesso.')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  async function deleteProduct(product: CatalogProduct) {
    if (!window.confirm(`Excluir o produto "${product.name}"?`)) return
    setError('')
    setNotice('')
    try {
      const { error: deleteError } = await requireSupabase().from('products')
        .delete().eq('id', product.id).eq('tenant_id', portal.tenantId)
      if (deleteError) throw deleteError
      setProducts((current) => current.filter((item) => item.id !== product.id))
      if (editingId === product.id) clearForm()
      setNotice('Produto excluído.')
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  return <section className="portal-panel">
    <div className="portal-panel-heading"><div><p className="eyebrow">CATÁLOGO</p><h2><Package size={17} /> Produtos e peças</h2></div><span>{canDelete ? 'Acesso total' : 'Edição sem exclusão/configurações'}</span></div>
    <form className="product-editor-form" onSubmit={saveProduct}>
      <div className="auth-form-row">
        <label>SKU<input required maxLength={80} value={sku} onChange={(event) => setSku(event.target.value)} /></label>
        <label>Nome da peça<input required maxLength={160} value={name} onChange={(event) => setName(event.target.value)} /></label>
      </div>
      <label>Descrição<textarea maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      <div className="auth-form-row">
        <label>Preço (R$)<input type="number" min="0" step="0.01" required value={price} onChange={(event) => setPrice(event.target.value)} /></label>
        <label>Estoque<input type="number" min="0" step="1" required value={stock} onChange={(event) => setStock(event.target.value)} /></label>
      </div>
      <label className="auth-checkbox"><input type="checkbox" checked={published} onChange={(event) => setPublished(event.target.checked)} /> Publicar na vitrine</label>
      <label>Foto da peça (PNG, JPEG ou WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setImageFile(event.target.files?.[0] ?? null)} /><small>{imageFile?.name ?? 'A imagem será redimensionada e convertida para WebP antes do envio.'}</small></label>
      {error && <p className="form-message form-error" role="alert">{error}</p>}
      {notice && <p className="form-message" role="status">{notice}</p>}
      <div className="product-form-actions">
        <button className="auth-button auth-button-primary" type="submit" disabled={busy}>{busy ? 'Salvando…' : editingId ? 'Atualizar produto' : 'Cadastrar produto'}</button>
        {editingId && <button className="auth-button auth-button-secondary" type="button" onClick={clearForm} disabled={busy}>Cancelar edição</button>}
      </div>
    </form>
    <div className="product-admin-list">
      {loading ? <p className="auth-description">Carregando produtos…</p> : products.length ? products.map((product) => <article key={product.id}>
        {product.image_url ? <img src={product.image_url} alt="" /> : <Package size={20} />}
        <div><b>{product.name}</b><small>{product.sku} · {money(Number(product.price))} · estoque {product.stock} · {product.is_published ? 'publicado' : 'rascunho'}</small></div>
        <button className="auth-button auth-button-secondary" type="button" onClick={() => editProduct(product)}>Editar</button>
        {canDelete && <button className="product-delete-button" type="button" aria-label={`Excluir ${product.name}`} onClick={() => void deleteProduct(product)}><Trash2 size={16} /></button>}
      </article>) : <p className="auth-description">Nenhum produto cadastrado.</p>}
    </div>
  </section>
}

function TenantBrandSettings({ portal, readOnly = false }: { portal: Portal; readOnly?: boolean }) {
  const [appName, setAppName] = useState(portal.brand.app_name ?? portal.tenantName)
  const [primaryColor, setPrimaryColor] = useState(portal.brand.primary_color ?? '#293125')
  const [tagline, setTagline] = useState(portal.brand.tagline ?? '')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoUrl, setLogoUrl] = useState(portal.logoUrl)
  const [logoPreview, setLogoPreview] = useState('')
  const [banners, setBanners] = useState(portal.brand.promotional_banners ?? [])
  const [bannerFiles, setBannerFiles] = useState<File[]>([])
  const [bannerPreviews, setBannerPreviews] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    const previews = bannerFiles.map((file) => URL.createObjectURL(file))
    setBannerPreviews(previews)
    return () => previews.forEach((preview) => URL.revokeObjectURL(preview))
  }, [bannerFiles])

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview('')
      return
    }
    const preview = URL.createObjectURL(logoFile)
    setLogoPreview(preview)
    return () => URL.revokeObjectURL(preview)
  }, [logoFile])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (readOnly) return
    setBusy(true)
    setError('')
    setNotice('')
    const uploadedPaths: string[] = []
    try {
      const client = requireSupabase()
      let updatedLogoUrl = logoUrl
      if (logoFile) {
        const image = await convertImageToWebP(logoFile)
        if (image.size > 5 * 1024 * 1024) {
          throw new Error('A logomarca excede o limite de 5 MB mesmo após a compactação.')
        }
        const path = `tenants/${portal.tenantId}/brand/logos/${crypto.randomUUID()}.webp`
        const { error: uploadError } = await client.storage.from('tenant-media').upload(path, image, {
          cacheControl: '3600',
          contentType: 'image/webp',
          upsert: false,
        })
        if (uploadError) throw uploadError
        uploadedPaths.push(path)
        updatedLogoUrl = `${client.storage.from('tenant-media').getPublicUrl(path).data.publicUrl}?v=${Date.now()}`
      }
      const uploadedBanners: string[] = []
      for (const [index, file] of bannerFiles.entries()) {
        const image = await convertImageToWebP(file, 1600, 0.82)
        if (image.size > 5 * 1024 * 1024) {
          throw new Error(`A imagem "${file.name}" excede o limite de 5 MB mesmo após a compactação.`)
        }
        const path = `tenants/${portal.tenantId}/brand/banners/${crypto.randomUUID()}-${index}.webp`
        const { error: uploadError } = await client.storage.from('tenant-media').upload(path, image, {
          cacheControl: '3600',
          contentType: 'image/webp',
          upsert: false,
        })
        if (uploadError) throw uploadError
        uploadedPaths.push(path)
        uploadedBanners.push(client.storage.from('tenant-media').getPublicUrl(path).data.publicUrl)
      }
      const updatedBanners = [...banners, ...uploadedBanners]
      const { error: updateError } = await client.rpc('update_tenant_brand_with_banners', {
        p_tenant_id: portal.tenantId,
        p_app_name: appName.trim(),
        p_primary_color: primaryColor,
        p_tagline: tagline.trim(),
        p_logo_url: updatedLogoUrl,
        p_banners: updatedBanners,
      })
      if (updateError) throw updateError
      uploadedPaths.length = 0
      setLogoUrl(updatedLogoUrl)
      setBanners(updatedBanners)
      setBannerFiles([])
      setLogoFile(null)
      setNotice('Alterações salvas. A vitrine e o aplicativo do motoboy já estão atualizados.')
    } catch (reason) {
      const saveError = errorText(reason)
      if (uploadedPaths.length) {
        const { error: cleanupError } = await requireSupabase().storage.from('tenant-media').remove(uploadedPaths)
        setError(cleanupError ? `${saveError} Não foi possível remover os arquivos enviados sem salvar: ${cleanupError.message}` : saveError)
      } else {
        setError(saveError)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="portal-panel">
      <div className="portal-panel-heading"><div><p className="eyebrow">PERSONALIZAÇÃO WHITE-LABEL</p><h2><Palette size={17} /> Aparência dos aplicativos</h2></div></div>
      <form className="brand-settings-form" onSubmit={save}>
        <label>Nome do aplicativo<input required minLength={2} maxLength={60} value={appName} onChange={(event) => setAppName(event.target.value)} disabled={readOnly || busy} /></label>
        <div className="brand-color-field">
          <span>Cor principal</span>
          <div className="brand-color-swatches" role="group" aria-label="Paleta de cores predefinidas">
            {BRAND_COLOR_SWATCHES.map((color) => <button
              key={color}
              type="button"
              className={primaryColor.toLowerCase() === color ? 'brand-color-swatch is-selected' : 'brand-color-swatch'}
              style={{ '--swatch-color': color } as React.CSSProperties}
              aria-label={`Selecionar cor ${color}`}
              aria-pressed={primaryColor.toLowerCase() === color}
              onClick={() => setPrimaryColor(color)}
              disabled={readOnly || busy}
            />)}
          </div>
          <label className="brand-hex-input">Código hexadecimal<input type="text" value={primaryColor} onChange={(event) => setPrimaryColor(event.target.value)} pattern="^#[0-9A-Fa-f]{6}$" maxLength={7} placeholder="#293125" aria-label="Código hexadecimal da cor principal" disabled={readOnly || busy} /></label>
        </div>
        <label>Frase da vitrine<input maxLength={120} value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="Ex.: Peças certas para seu veículo" disabled={readOnly || busy} /></label>
        <label className="brand-logo-input">Logomarca (PNG, JPEG ou WebP)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogoFile(event.target.files?.[0] ?? null)} disabled={readOnly || busy} /><small>{logoFile?.name ?? 'A imagem é convertida para WebP e limitada a 800 px de largura.'}</small>{(logoPreview || logoUrl) && <img className="brand-logo-preview" src={logoPreview || logoUrl || ''} alt={`Prévia da logomarca de ${portal.tenantName}`} />}</label>
        <div className="brand-banners">
          <h3>Banners Promocionais da Vitrine</h3>
          <p>Adicione até 5 imagens. Elas serão redimensionadas e convertidas para WebP antes do envio.</p>
          <label>Selecionar banners<input type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={readOnly || busy || banners.length + bannerFiles.length >= 5} onChange={(event) => {
            const selectedFiles = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            const availableSlots = 5 - banners.length - bannerFiles.length
            if (selectedFiles.length > availableSlots) {
              setError(`Você pode manter no máximo 5 banners. Ainda há ${availableSlots} vaga(s) disponível(is).`)
              return
            }
            setError('')
            setBannerFiles((current) => [...current, ...selectedFiles])
          }} /></label>
          <div className="brand-banner-grid">
            {banners.map((url, index) => <figure key={url}>
              <img src={url} alt={`Banner promocional ${index + 1}`} />
              {!readOnly && <button type="button" aria-label={`Remover banner ${index + 1}`} disabled={busy} onClick={() => setBanners((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>}
            </figure>)}
            {bannerFiles.map((file, index) => <figure key={`${file.name}-${index}`}>
              <img src={bannerPreviews[index]} alt={`Prévia do banner ${file.name}`} />
              {!readOnly && <button type="button" aria-label={`Remover arquivo ${file.name}`} disabled={busy} onClick={() => setBannerFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>}
            </figure>)}
          </div>
          <small>{banners.length + bannerFiles.length} de 5 banners selecionados</small>
        </div>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {notice && <p className="form-message brand-save-toast" role="status">{notice}</p>}
        {!readOnly && <button className="auth-button auth-button-primary brand-save-button" type="submit" disabled={busy}>
          <Upload size={15} /> {busy ? 'Salvando…' : 'Salvar Alterações'}
        </button>}
      </form>
    </section>
  )
}

function CourierPortal({ user, portal, onLogout, masterPreview = false }: { user: User; portal: Portal; onLogout: () => void; masterPreview?: boolean }) {
  return (
    <main className="portal-page" style={{ '--store-color': portal.brand.primary_color ?? '#293125' } as React.CSSProperties}>
      {masterPreview && <MasterViewingBanner tenantName={portal.tenantName} />}
      <PortalHeader user={user} title={`Entregas · ${portal.tenantName}`} onLogout={onLogout} />
      <section className="portal-content">
        <p className="eyebrow">PWA DO ENTREGADOR</p>
        {portal.logoUrl && <img className="tenant-logo-preview" src={portal.logoUrl} alt={`Logomarca ${portal.tenantName}`} />}
        <h1>Olá, {user.user_metadata?.full_name ?? user.email}</h1>
        <p className="auth-description">{portal.brand.tagline || `Você está autenticado como entregador da ${portal.tenantName}.`} Corridas e carteira serão exibidas quando a integração de pedidos e entregas estiver disponível.</p>
        <a className="auth-subtle-link" href={masterPreview ? `/app/${encodeURIComponent(portal.slug)}` : '/app'}>Acessar ambiente da loja</a>
      </section>
    </main>
  )
}

function MasterViewingBanner({ tenantName }: { tenantName: string }) {
  return <aside className="master-viewing-banner"><span>Você está visualizando a loja <b>{tenantName}</b> como Admin Master.</span><a href="/admin">Voltar à Central Vancely</a></aside>
}

function PortalHeader({
  user,
  title,
  onLogout,
  tenantOptions,
}: {
  user: User
  title: string
  onLogout: () => void
  tenantOptions?: Pick<MasterStoreMetrics, 'id' | 'name' | 'slug'>[]
}) {
  return <header className="portal-header"><a href="/"><Brand /></a><span>{title}</span>{tenantOptions && <label className="master-tenant-select">Visualizar loja<select value="" aria-label="Assumir visão de uma loja" onChange={(event) => {
    if (event.target.value) navigate(`/app/${encodeURIComponent(event.target.value)}`)
  }}><option value="">Selecione uma loja…</option>{tenantOptions.map((tenant) => <option key={tenant.id} value={tenant.slug}>{tenant.name}</option>)}</select></label>}<div><small>{user.email}</small><button className="auth-button auth-button-secondary" onClick={onLogout}>Sair</button></div></header>
}

function AdminDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<MasterDashboardData | null>(null)
  const [error, setError] = useState('')
  const [supportOpen, setSupportOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState('')

  async function loadAnalytics() {
    setLoading(true)
    setError('')
    try {
      const { data, error: queryError } = await requireSupabase().rpc('get_master_dashboard_analytics')
      if (queryError) throw queryError
      const result = data as MasterDashboardData
      setDashboard(result)
      setSelectedMonth((current) => current || result.monthly_trend.at(-1)?.month || '')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAnalytics()
  }, [])

  const stores = dashboard?.stores ?? []
  const selectedTrend = dashboard?.monthly_trend.find((trend) => trend.month === selectedMonth)
  const monthlySales = stores.reduce((total, store) => total + Number(store.monthly_paid_sales), 0)
  const monthlySplit = stores.reduce((total, store) => total + Number(store.monthly_split_amount), 0)
  const monthlyDeliveries = stores.reduce((total, store) => total + Number(store.monthly_delivered), 0)
  const monthlyDeliveryFees = stores.reduce((total, store) => total + Number(store.monthly_delivery_fees), 0)
  const monthlyRouteFees = stores.reduce((total, store) => total + Number(store.monthly_route_fee_estimate), 0)
  const trendMax = Math.max(1, ...(dashboard?.monthly_trend ?? []).flatMap((trend) => [Number(trend.split_revenue), Number(trend.renewals_forecast_amount)]))

  return (
    <main className="portal-page">
      <PortalHeader user={user} title="Software Pai Vancely" onLogout={onLogout} tenantOptions={stores} />
      <section className="portal-content">
        <p className="eyebrow">ADMINISTRAÇÃO SAAS</p>
        <h1>Central Vancely</h1>
        <p className="auth-description">Acesso administrativo verificado pelo perfil seguro do Supabase Auth.</p>
        <div className="admin-heading-actions">
          <span>{dashboard ? `Atualizado ${new Date(dashboard.generated_at).toLocaleTimeString('pt-BR')}` : 'Painel de métricas'}</span>
          <button className="auth-button auth-button-secondary" onClick={() => void loadAnalytics()} disabled={loading}><RefreshCw size={15} /> Atualizar</button>
        </div>
        {error && <p className="form-message form-error" role="alert">{error}</p>}
        {loading && !dashboard ? <p className="auth-description">Carregando métricas da plataforma…</p> : dashboard && <>
          <div className="admin-metrics-grid">
            <article><Store size={18} /><span>Lojas cadastradas</span><b>{stores.length}</b><small>{stores.filter((store) => store.status === 'active').length} ativas</small></article>
            <article><ChartNoAxesCombined size={18} /><span>Vendas pagas neste mês</span><b>{money(monthlySales)}</b><small>Subtotal registrado nos pedidos pagos</small></article>
            <article><LockKeyhole size={18} /><span>Split gerado neste mês</span><b>{money(monthlySplit)}</b><small>Receita reconhecida somente após liquidação: {money(stores.reduce((total, store) => total + Number(store.monthly_split_settled), 0))}</small></article>
            <article><ArrowRight size={18} /><span>Entregas concluídas</span><b>{monthlyDeliveries}</b><small>Fretes registrados: {money(monthlyDeliveryFees)}</small></article>
          </div>
          <div className="admin-analytics-grid">
            <section className="portal-panel">
              <div className="portal-panel-heading"><div><p className="eyebrow">12 MESES</p><h2>Splits e renovações previstas</h2></div><div className="admin-chart-legend"><span><i /> Split</span><span><i /> Renovação prevista</span></div></div>
              <div className="admin-chart" role="group" aria-label="Gráfico mensal interativo de split e renovações previstas">
                {dashboard.monthly_trend.map((trend) => {
                  const splitHeight = Math.max(2, Number(trend.split_revenue) / trendMax * 100)
                  const renewalHeight = Math.max(2, Number(trend.renewals_forecast_amount) / trendMax * 100)
                  const monthName = monthDisplayDate(trend.month).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
                  return <button className={`admin-chart-month ${selectedMonth === trend.month ? 'admin-chart-month-active' : ''}`} key={trend.month} onClick={() => setSelectedMonth(trend.month)} aria-pressed={selectedMonth === trend.month} aria-label={`${monthName}: split ${money(Number(trend.split_revenue))}, ${trend.renewals_forecast} renovações previstas`}>
                    <span className="admin-chart-bars"><i style={{ height: `${splitHeight}%` }} /><i style={{ height: `${renewalHeight}%` }} /></span>
                    <small>{monthName}</small>
                  </button>
                })}
              </div>
              {selectedTrend && <p className="admin-chart-summary">
                <b>{monthDisplayDate(selectedTrend.month).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</b>
                <span>Split: {money(Number(selectedTrend.split_revenue))}</span>
                <span>Liquidado: {money(Number(selectedTrend.settled_split_revenue))}</span>
                <span>Renovações previstas: {selectedTrend.renewals_forecast} · {money(Number(selectedTrend.renewals_forecast_amount))}</span>
              </p>}
              <p className="admin-disclaimer">Renovações são projeções de assinatura, não pagamentos processados. Esta base não possui histórico financeiro do gateway.</p>
            </section>
            <section className="portal-panel">
              <div className="portal-panel-heading"><div><p className="eyebrow">USO DA PLATAFORMA</p><h2>Consultas de placas</h2></div></div>
              <div className="plate-analytics-grid">
                {[
                  ['Hoje', dashboard.plate_lookups.daily, dashboard.plate_lookups.daily_api],
                  ['Semana', dashboard.plate_lookups.weekly, dashboard.plate_lookups.weekly_api],
                  ['Mês', dashboard.plate_lookups.monthly, dashboard.plate_lookups.monthly_api],
                  ['Ano', dashboard.plate_lookups.yearly, dashboard.plate_lookups.yearly_api],
                ].map(([label, count, apiCount]) => <div key={label}><small>{label}</small><b>{count}</b><span>{apiCount} via API</span></div>)}
              </div>
              <p className="admin-cost-line">API estimada (mês) <b>{money(Number(dashboard.plate_lookups.monthly_api_cost))}</b></p>
              <p className="admin-cost-line">Taxa estimada de cache (R$ 0,03/consulta) <b>{money(Number(dashboard.plate_lookups.monthly_cache_fee_estimate))}</b></p>
              <p className="admin-disclaimer">Limites de placas por plano e cobrança efetiva ainda não estão configurados.</p>
            </section>
          </div>
          <section className="admin-analytics-grid admin-operations-grid">
            <section className="portal-panel">
              <div className="portal-panel-heading"><div><p className="eyebrow">LOGÍSTICA</p><h2>Rotas e taxas registradas</h2></div></div>
              <div className="admin-logistics-summary"><div><small>Entregas concluídas no mês</small><b>{monthlyDeliveries}</b></div><div><small>Frete registrado nos pedidos</small><b>{money(monthlyDeliveryFees)}</b></div><div><small>Taxa estimada pelas regras e rotas</small><b>{money(monthlyRouteFees)}</b></div></div>
              <p className="admin-disclaimer">A estimativa aplica as regras existentes (km grátis e preço por km) às distâncias dos pedidos entregues. Custos de chamadas de geocodificação e roteirização não são contabilizados; o cálculo não substitui a cobrança efetiva.</p>
            </section>
            <section className="portal-panel">
              <div className="portal-panel-heading"><div><p className="eyebrow">RECEITAS ADICIONAIS</p><h2>Produtos e NF-e</h2></div></div>
              <p className="admin-disclaimer">O schema atual não registra vendas de blocos de estoque nem de notas fiscais adicionais. Nenhum valor é contabilizado para evitar receita fictícia ou duplicada.</p>
            </section>
          </section>
        </>}
        <section className="tenant-list">
          <div className="portal-panel-heading"><div><p className="eyebrow">LOJAS E PLANOS</p><h2>Lojas cadastradas</h2></div><button className="auth-button auth-button-primary" onClick={() => setSupportOpen(true)}><MessageCircle size={15} /> Central de suporte</button></div>
          {!loading && !error && stores.length === 0 ? <p className="auth-description">Nenhuma loja cadastrada.</p> : stores.map((store) => (
            <article className="tenant-row" key={store.id}>
              <div className="tenant-row-heading"><div><b>{store.name}</b><small>/loja/{store.slug} · {store.plan_name ?? 'Sem plano'}</small></div><span className={`tenant-status status-${store.status}`}>{store.status}</span></div>
              <nav className="tenant-pwa-actions" aria-label={`Aplicativos de ${store.name}`}>
                <a className="tenant-pwa-action" href={`/loja/${encodeURIComponent(store.slug)}`}><ShoppingCart size={15} /> Vitrine Cliente</a>
                <a className="tenant-pwa-action" href={`/app/${encodeURIComponent(store.slug)}`}><PanelsTopLeft size={15} /> Painel Lojista</a>
                <a className="tenant-pwa-action" href={`/driver/${encodeURIComponent(store.slug)}`}><Bike size={15} /> App Motoboy</a>
              </nav>
              <div className="tenant-metrics">
                <span><small>Vendas pagas no mês</small><b>{money(Number(store.monthly_paid_sales))}</b></span>
                <span><small>Pedidos pagos</small><b>{store.monthly_paid_orders}</b></span>
                <span><small>Entregas concluídas</small><b>{store.monthly_delivered}</b></span>
                <span><small>Plano / mensalidade</small><b>{store.plan_name ?? '—'} · {store.monthly_price == null ? '—' : `${money(Number(store.monthly_price))}/mês`}</b></span>
                <span><small>Comissão do plano</small><b>{store.commission_rate == null ? '—' : `${(Number(store.commission_rate) * 100).toLocaleString('pt-BR')}%`}</b></span>
                <span><small>Split gerado / liquidado</small><b>{money(Number(store.monthly_split_amount))} / {money(Number(store.monthly_split_settled))}</b></span>
                <span><small>Frete registrado</small><b>{money(Number(store.monthly_delivery_fees))}</b></span>
                <span><small>Taxa estimada por rota</small><b>{money(Number(store.monthly_route_fee_estimate))}</b></span>
                <span><small>Distância média registrada</small><b>{store.monthly_average_distance_km == null ? '—' : `${Number(store.monthly_average_distance_km).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`}</b></span>
                <span><small>Renovação prevista</small><b>{store.current_period_end ? new Date(store.current_period_end).toLocaleDateString('pt-BR') : '—'} · {store.subscription_status ?? 'sem assinatura'}</b></span>
              </div>
            </article>
          ))}
        </section>
      </section>
      {supportOpen && <SupportDialog user={user} admin onClose={() => setSupportOpen(false)} />}
    </main>
  )
}

function StorefrontPage({ slug }: { slug: string }) {
  const [store, setStore] = useState<{
    id: string
    name: string
    logo_url: string | null
    brand: { app_name?: string; primary_color?: string; tagline?: string; promotional_banners?: string[] }
  } | null>(null)
  const [products, setProducts] = useState<{ id: string; name: string; description: string | null; price: number; stock: number; image_url: string | null }[]>([])
  const [masterViewing, setMasterViewing] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const client = requireSupabase()
        const { data: sessionData, error: sessionError } = await client.auth.getSession()
        if (sessionError) throw sessionError
        let isMaster = false
        if (sessionData.session) {
          const { data: userData, error: userError } = await client.auth.getUser()
          if (userError) throw userError
          isMaster = userData.user ? isAdminUser(userData.user) : false
        }
        const { data, error: queryError } = isMaster
          ? await client.rpc('get_master_tenant_by_slug', { p_slug: slug })
          : await client.rpc('get_public_tenant', { p_slug: slug })
        if (queryError) throw queryError
        const currentStore = (data?.[0] as typeof store) ?? null
        if (!active) return
        setMasterViewing(isMaster)
        setStore(currentStore)
        if (currentStore) {
          const { data: catalog, error: catalogError } = await client.from('products')
            .select('id, name, description, price, stock, image_url')
            .eq('tenant_id', currentStore.id)
            .eq('is_published', true)
            .order('name')
          if (catalogError) throw catalogError
          if (active) setProducts((catalog ?? []) as typeof products)
        }
      } catch (reason) {
        if (active) setError(errorText(reason))
      }
    })()
    return () => { active = false }
  }, [slug])
  return <main className="storefront-page">
    {masterViewing && store && <MasterViewingBanner tenantName={store.name} />}
    <section className="storefront-shell" style={{ '--store-color': store?.brand.primary_color ?? '#718c28' } as React.CSSProperties}>
      <header className="storefront-heading">
        {store?.logo_url && <img className="storefront-logo" src={store.logo_url} alt={`Logomarca ${store.name}`} />}
        <p className="eyebrow">VITRINE B2C</p>
        {error ? <><h1>Vitrine indisponível</h1><p className="auth-description">{error}</p></> : store ? <><h1>{store.brand.app_name ?? store.name}</h1><p className="auth-description">{store.brand.tagline || `Vitrine oficial ${store.name}.`}</p></> : <h1>Carregando vitrine…</h1>}
        <a className="auth-subtle-link" href={masterViewing ? '/admin' : '/login'}>{masterViewing ? 'Voltar à Central Vancely' : 'Acesso da loja'}</a>
      </header>
      {store && !error && !!store.brand.promotional_banners?.length && <PromoBannerCarousel banners={store.brand.promotional_banners} />}
      {store && !error && <section className="storefront-catalog">
        <div className="portal-panel-heading"><div><p className="eyebrow">CATÁLOGO</p><h2>Produtos disponíveis</h2></div></div>
        {products.length ? <div className="storefront-products">{products.map((product) => <article key={product.id}>
          {product.image_url && <img src={product.image_url} alt="" />}
          <div><h3>{product.name}</h3>{product.description && <p>{product.description}</p>}<b>{money(Number(product.price))}</b><small>{product.stock > 0 ? `${product.stock} em estoque` : 'Consulte disponibilidade'}</small></div>
        </article>)}</div> : <p className="auth-description">Ainda não há produtos publicados para esta loja.</p>}
        <DeliveryQuotePanel storeId={store.id} />
      </section>}
    </section>
  </main>
}

function PromoBannerCarousel({ banners }: { banners: string[] }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const currentIndex = activeIndex % banners.length
  return <section className="storefront-banner-carousel" aria-label="Ofertas e banners promocionais">
    <img src={banners[currentIndex]} alt={`Oferta promocional ${currentIndex + 1}`} />
    {banners.length > 1 && <>
      <button type="button" aria-label="Banner anterior" onClick={() => setActiveIndex((index) => (index - 1 + banners.length) % banners.length)}><ArrowLeft size={18} /></button>
      <button type="button" aria-label="Próximo banner" onClick={() => setActiveIndex((index) => (index + 1) % banners.length)}><ArrowRight size={18} /></button>
      <div className="storefront-banner-dots">{banners.map((_, index) => <button key={index} type="button" aria-label={`Exibir banner ${index + 1}`} aria-current={index === currentIndex} onClick={() => setActiveIndex(index)} />)}</div>
    </>}
  </section>
}

function DeliveryQuotePanel({ storeId }: { storeId: string }) {
  const [cep, setCep] = useState('')
  const [quote, setQuote] = useState<DeliveryQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setQuote(null)
    try {
      const destinationCep = cep.replace(/\D/g, '')
      if (destinationCep.length !== 8) {
        throw new Error('Informe um CEP de destino válido com 8 dígitos.')
      }
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
      if (!anonKey) {
        throw new Error('Supabase ainda não está configurado. Preencha VITE_SUPABASE_ANON_KEY.')
      }
      const { data, error: quoteError } = await requireSupabase().functions.invoke('quote-delivery', {
        body: { store_id: storeId, destination_cep: destinationCep },
        headers: { Authorization: `Bearer ${anonKey}` },
      })
      if (quoteError) {
        if (quoteError.context instanceof Response) {
          const responseBody = await quoteError.context.clone().json().catch(() => null)
          if (typeof responseBody?.error === 'string') throw new Error(responseBody.error)
        }
        throw quoteError
      }
      if (!data || typeof data.shipping_amount !== 'number'
        || data.geometry?.type !== 'LineString' || !Array.isArray(data.geometry.coordinates)) {
        throw new Error('O serviço de rotas retornou uma cotação inválida.')
      }
      setQuote(data as DeliveryQuote)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  return <section className="delivery-quote-panel" aria-labelledby="delivery-quote-title">
    <div><p className="eyebrow">ENTREGA</p><h3 id="delivery-quote-title"><MapPinned size={17} /> Calcular frete para o seu CEP</h3></div>
    <form onSubmit={calculate}>
      <label htmlFor="delivery-destination-cep">CEP de destino</label>
      <div className="delivery-quote-input">
        <input
          id="delivery-destination-cep"
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={9}
          pattern="[0-9]{5}-?[0-9]{3}"
          placeholder="00000-000"
          required
          value={cep}
          onChange={(event) => setCep(event.target.value.replace(/[^\d-]/g, '').slice(0, 9))}
        />
        <button className="auth-button auth-button-primary" type="submit" disabled={busy}>
          {busy ? 'Calculando…' : 'Calcular entrega'}
        </button>
      </div>
    </form>
    {error && <p className="form-message form-error" role="alert">{error}</p>}
    {quote && <div className="delivery-quote-result" role="status">
      <b>{quote.shipping_amount === 0 ? 'Frete grátis' : money(quote.shipping_amount)}</b>
      <span>{quote.distance_km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km</span>
      <span><Clock3 size={14} /> {Math.ceil(quote.duration_seconds / 60)} min estimados</span>
      <small>{quote.cache_hit ? 'Rota obtida do cache local.' : 'Rota calculada com OSRM e salva no cache local.'}</small>
      <Suspense fallback={<div className="route-map route-map-loading">Carregando mapa…</div>}>
        <RouteMap geometry={quote.geometry} />
      </Suspense>
    </div>}
  </section>
}

function SupportDialog({ user, tenantId, admin = false, onClose }: { user: User; tenantId?: string; admin?: boolean; onClose: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [botAnswers, setBotAnswers] = useState<{ question: string; answer: string }[]>([])
  const [handoffQuestion, setHandoffQuestion] = useState('')
  const activeConversation = conversations.find((conversation) => conversation.id === activeId)

  async function loadConversations() {
    const client = requireSupabase()
    let query = client.from('support_conversations').select('id, tenant_id, subject, status, created_at').order('updated_at', { ascending: false })
    if (!admin && tenantId) query = query.eq('tenant_id', tenantId)
    const { data, error: queryError } = await query
    if (queryError) throw queryError
    const rows = (data ?? []) as Conversation[]
    setConversations(rows)
    setActiveId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? '')
  }

  useEffect(() => {
    let active = true
    void loadConversations().catch((reason) => { if (active) setError(errorText(reason)) })
    const channel = requireSupabase().channel(`support-conversations-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_conversations' }, () => {
        void loadConversations().catch((reason) => setError(errorText(reason)))
      }).subscribe()
    return () => {
      active = false
      void requireSupabase().removeChannel(channel)
    }
  }, [tenantId, admin, user.id])

  useEffect(() => {
    if (!activeId) {
      setMessages([])
      return
    }
    let active = true
    const client = requireSupabase()
    const loadMessages = async () => {
      const { data, error: queryError } = await client.from('support_messages')
        .select('id, conversation_id, sender_id, body, created_at')
        .eq('conversation_id', activeId).order('created_at')
      if (queryError) throw queryError
      if (active) setMessages((data ?? []) as SupportMessage[])
    }
    void loadMessages().catch((reason) => { if (active) setError(errorText(reason)) })
    const channel = client.channel(`support-messages-${activeId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `conversation_id=eq.${activeId}` }, () => {
        void loadMessages().catch((reason) => setError(errorText(reason)))
      }).subscribe()
    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [activeId])

  function askBot(question: string) {
    const lower = question.toLocaleLowerCase('pt-BR')
    const answer = lower.includes('senha') || lower.includes('login')
      ? 'Para acessar, use o e-mail cadastrado em /login. Se o problema continuar, solicite atendimento humano.'
      : lower.includes('placa') || lower.includes('veículo')
        ? 'A consulta de placa depende da API de veículos configurada pela Vancely. A equipe pode verificar o status da integração.'
        : lower.includes('pedido') || lower.includes('entrega')
          ? 'Pedidos e entregas dependem das integrações operacionais da loja. Posso encaminhar sua dúvida para a equipe.'
          : 'Ainda não encontrei uma resposta automática para isso. Você pode tentar outra dúvida ou falar com a equipe Vancely.'
    setBotAnswers((current) => [...current, { question, answer }])
    setHandoffQuestion(question)
  }

  async function startHumanSupport() {
    if (!tenantId) return
    setError('')
    try {
      const client = requireSupabase()
      const subject = handoffQuestion || 'Solicitação de suporte'
      const { data, error: createError } = await client.from('support_conversations')
        .insert({ tenant_id: tenantId, created_by: user.id, subject })
        .select('id, tenant_id, subject, status, created_at').single()
      if (createError) throw createError
      const conversation = data as Conversation
      const { error: messageError } = await client.from('support_messages').insert({
        conversation_id: conversation.id, sender_id: user.id,
        body: handoffQuestion ? `Triagem: ${handoffQuestion}` : 'Solicito atendimento humano.',
      })
      if (messageError) throw messageError
      setConversations((current) => [conversation, ...current])
      setActiveId(conversation.id)
      setBotAnswers([])
      setHandoffQuestion('')
    } catch (reason) {
      setError(errorText(reason))
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const body = draft.trim()
    if (!body) return
    if (!activeId && !admin) {
      askBot(body)
      setDraft('')
      return
    }
    if (!activeId) return
    setError('')
    const { error: sendError } = await requireSupabase().from('support_messages').insert({
      conversation_id: activeId, sender_id: user.id, body,
    })
    if (sendError) setError(sendError.message)
    else setDraft('')
  }

  return (
    <div className="support-overlay" role="dialog" aria-modal="true" aria-label={admin ? 'Central de suporte' : 'Suporte Vancely'}>
      <section className={`support-dialog ${admin ? 'support-admin' : ''}`}>
        <header className="support-header"><div><MessageCircle size={19} /><span><b>{admin ? 'Central de suporte' : 'Suporte Vancely'}</b><small>{admin ? 'Atendimento dos lojistas' : 'Triagem e atendimento humano'}</small></span></div><button className="support-close" aria-label="Fechar" onClick={onClose}><X size={18} /></button></header>
        <div className="support-body">
          {(admin || conversations.length > 0) && <nav className="support-threads" aria-label="Chamados">
            {!admin && <button className="new-thread-button" onClick={() => { setActiveId(''); setBotAnswers([]); setHandoffQuestion('') }}>Novo chamado</button>}
            {conversations.map((conversation) => <button key={conversation.id} className={conversation.id === activeId ? 'thread-active' : ''} onClick={() => setActiveId(conversation.id)}><b>{conversation.subject}</b><small>{conversation.status} · {conversation.tenant_id.slice(0, 8)}</small></button>)}
            {!conversations.length && <p>Nenhum chamado encontrado.</p>}
          </nav>}
          <section className="support-conversation">
            {!activeId && !admin ? <div className="bot-triage">
              <div className="bot-message">Olá! Sou o assistente Vancely. Como posso ajudar? Se eu não resolver, conecto você ao atendimento humano.</div>
              {botAnswers.map((entry, index) => <div className="bot-answer" key={`${index}-${entry.question}`}><div className="user-message">{entry.question}</div><div className="bot-message">{entry.answer}</div></div>)}
              <div className="faq-choices">
                <button onClick={() => askBot('Preciso de ajuda com login e senha')}>Login e senha</button>
                <button onClick={() => askBot('Como funciona a consulta de placa?')}>Consulta de placa</button>
                <button onClick={() => askBot('Tenho uma dúvida sobre pedido ou entrega')}>Pedidos e entregas</button>
              </div>
              {handoffQuestion && <button className="handoff-button" onClick={() => void startHumanSupport()}>Falar com atendimento humano <ArrowRight size={15} /></button>}
            </div> : activeConversation || admin ? <>
              <div className="message-list">
                {messages.map((message) => <div className={`chat-message ${message.sender_id === user.id ? 'chat-own' : ''}`} key={message.id}><p>{message.body}</p><time>{new Date(message.created_at).toLocaleString('pt-BR')}</time></div>)}
                {!messages.length && <p className="empty-chat">Selecione um chamado para acompanhar a conversa.</p>}
              </div>
              {activeId && <form className="chat-compose" onSubmit={sendMessage}><input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Escreva uma mensagem…" required /><button aria-label="Enviar mensagem"><Send size={16} /></button></form>}
            </> : <div className="empty-chat">Selecione uma conversa ou comece pela triagem.</div>}
            {error && <p className="form-message form-error" role="alert">{error}</p>}
            {!admin && <div className="support-contact-links">
              <a href={`https://wa.me/${SUPPORT_WHATSAPP}`} target="_blank" rel="noreferrer">WhatsApp</a>
              <a href={`mailto:${SUPPORT_EMAIL}`}>E-mail</a>
            </div>}
          </section>
        </div>
      </section>
    </div>
  )
}
