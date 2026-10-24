import { useEffect, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowLeft, ArrowRight, LifeBuoy, LockKeyhole, MessageCircle, Send, Store, X } from 'lucide-react'
import { requireSupabase } from './services/supabase'

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
type Portal = { tenantId: string; tenantName: string; role: string; slug: string }
type Conversation = { id: string; tenant_id: string; subject: string; status: string; created_at: string }
type SupportMessage = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string }

const money = (amount: number) => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const TERMS_VERSION = '2026-10-23-v1'
const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'vancelysoftware@gmail.com'
const SUPPORT_WHATSAPP = import.meta.env.VITE_SUPPORT_WHATSAPP || '5592920021316'

function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Ocorreu um erro inesperado. Tente novamente.'
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
    .select('name, slug')
    .eq('id', member.tenant_id)
    .maybeSingle()
  if (tenantError) throw tenantError
  if (!tenant) throw new Error('A loja vinculada a esta conta não está disponível.')
  return {
    tenantId: member.tenant_id,
    tenantName: String(tenant.name),
    slug: String(tenant.slug),
    role: member.role,
  }
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (path === '/registrar') return <RegistrationPage />
  if (path === '/login') return <LoginPage kind="merchant" />
  if (path === '/admin/login') return <LoginPage kind="admin" />
  const storefrontMatch = path.match(/^\/loja\/([^/]+)$/)
  if (storefrontMatch) return <StorefrontPage slug={decodeURIComponent(storefrontMatch[1])} />
  if (path === '/admin' || path === '/app' || path === '/entregador') {
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
        navigate('/admin')
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
        const { data, error: userError } = await client.auth.getUser()
        if (userError) throw userError
        if (!data.user) {
          navigate(path === '/admin' ? '/admin/login' : '/login')
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
  if (path === '/entregador') return <CourierPortal user={user} onLogout={logout} />
  return <MerchantPortal user={user} portal={portal} onLogout={logout} />
}

function PageMessage({ title, message, link, linkText }: { title: string; message?: string; link?: string; linkText?: string }) {
  return <main className="auth-page"><section className="auth-card"><Brand /><h1>{title}</h1>{message && <p className="auth-description">{message}</p>}{link && <a className="auth-button auth-button-primary" href={link}>{linkText ?? 'Continuar'}</a>}</section></main>
}

function MerchantPortal({ user, portal, onLogout }: { user: User; portal: Portal; onLogout: () => void }) {
  const [supportOpen, setSupportOpen] = useState(false)
  return (
    <main className="portal-page">
      <PortalHeader user={user} title={portal.tenantName} onLogout={onLogout} />
      <section className="portal-content">
        <p className="eyebrow">AMBIENTE DA LOJA · {portal.role.toUpperCase()}</p>
        <h1>Bem-vindo à {portal.tenantName}</h1>
        <p className="auth-description">O acesso está autenticado e isolado para esta loja. Os módulos operacionais serão habilitados conforme as APIs de produção forem conectadas.</p>
        <div className="portal-cards">
          <article><Store size={20} /><h2>Dados da loja</h2><p>Vitrine: <a href={`/loja/${portal.slug}`} target="_blank" rel="noreferrer">/loja/{portal.slug}</a></p></article>
          <article><LifeBuoy size={20} /><h2>Suporte</h2><p>Triagem inicial e atendimento humano pela central Vancely.</p><button className="auth-button auth-button-secondary" onClick={() => setSupportOpen(true)}>Abrir suporte</button></article>
          <article><LockKeyhole size={20} /><h2>Integrações</h2><p>Catálogo, pedidos, faturamento e entregas aguardam configuração das APIs correspondentes.</p></article>
        </div>
      </section>
      {supportOpen && <SupportDialog user={user} tenantId={portal.tenantId} onClose={() => setSupportOpen(false)} />}
    </main>
  )
}

function CourierPortal({ user, onLogout }: { user: User; onLogout: () => void }) {
  return (
    <main className="portal-page">
      <PortalHeader user={user} title="Área do entregador" onLogout={onLogout} />
      <section className="portal-content">
        <p className="eyebrow">PWA DO ENTREGADOR</p>
        <h1>Olá, {user.user_metadata?.full_name ?? user.email}</h1>
        <p className="auth-description">Você está autenticado como entregador. Corridas, rotas e carteira serão exibidas quando as APIs de pedidos, mapas e pagamentos estiverem configuradas.</p>
        <a className="auth-subtle-link" href="/app">Acessar ambiente da loja</a>
      </section>
    </main>
  )
}

function PortalHeader({ user, title, onLogout }: { user: User; title: string; onLogout: () => void }) {
  return <header className="portal-header"><a href="/"><Brand /></a><span>{title}</span><div><small>{user.email}</small><button className="auth-button auth-button-secondary" onClick={onLogout}>Sair</button></div></header>
}

function AdminDashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [tenants, setTenants] = useState<{ id: string; name: string; slug: string; status: string }[]>([])
  const [error, setError] = useState('')
  const [supportOpen, setSupportOpen] = useState(false)
  useEffect(() => {
    let active = true
    void requireSupabase().from('tenants').select('id, name, slug, status').order('created_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (!active) return
        if (queryError) setError(queryError.message)
        else setTenants((data ?? []) as typeof tenants)
      })
    return () => { active = false }
  }, [])
  return (
    <main className="portal-page">
      <PortalHeader user={user} title="Software Pai Vancely" onLogout={onLogout} />
      <section className="portal-content">
        <p className="eyebrow">ADMINISTRAÇÃO SAAS</p>
        <h1>Central Vancely</h1>
        <p className="auth-description">Acesso administrativo verificado pelo perfil seguro do Supabase Auth.</p>
        <div className="portal-cards">
          <article><Store size={20} /><h2>Lojistas</h2><p>{tenants.length} lojas registradas</p></article>
          <article><MessageCircle size={20} /><h2>Atendimento</h2><p>Central de chamados com atualização em tempo real.</p><button className="auth-button auth-button-primary" onClick={() => setSupportOpen(true)}>Abrir central de suporte</button></article>
          <article><LockKeyhole size={20} /><h2>Faturamento e integrações</h2><p>Micropagamentos, notas fiscais e integrações serão exibidos quando suas APIs estiverem configuradas.</p></article>
        </div>
        <section className="tenant-list">
          <h2>Lojas cadastradas</h2>
          {error && <p className="form-message form-error" role="alert">{error}</p>}
          {tenants.length === 0 && !error ? <p className="auth-description">Nenhuma loja cadastrada.</p> : tenants.map((tenant) => (
            <div className="tenant-row" key={tenant.id}><div><b>{tenant.name}</b><small>/loja/{tenant.slug}</small></div><span className={`tenant-status status-${tenant.status}`}>{tenant.status}</span></div>
          ))}
        </section>
      </section>
      {supportOpen && <SupportDialog user={user} admin onClose={() => setSupportOpen(false)} />}
    </main>
  )
}

function StorefrontPage({ slug }: { slug: string }) {
  const [store, setStore] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data, error: queryError } = await requireSupabase().rpc('get_public_tenant', { p_slug: slug })
        if (queryError) throw queryError
        if (active) setStore((data?.[0] as { id: string; name: string } | undefined) ?? null)
      } catch (reason) {
        if (active) setError(errorText(reason))
      }
    })()
    return () => { active = false }
  }, [slug])
  return <main className="auth-page"><section className="auth-card"><Brand /><p className="eyebrow">VITRINE B2C</p>{error ? <><h1>Vitrine indisponível</h1><p className="auth-description">{error}</p></> : store ? <><h1>{store.name}</h1><p className="auth-description">A vitrine será exibida após a configuração do catálogo e das APIs da loja.</p></> : <h1>Carregando vitrine…</h1>}<a className="auth-subtle-link" href="/login">Acesso da loja</a></section></main>
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
