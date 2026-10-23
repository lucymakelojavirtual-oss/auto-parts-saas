import { useEffect, useMemo, useState, type ChangeEvent } from 'react'
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, BadgeCheck, Bike, Box,
  CarFront, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CreditCard, Gauge, ImagePlus,
  LayoutDashboard, MapPin, Menu, Minus, PackageCheck, Plus, Search, Settings2,
  ShieldCheck, ShoppingBag, ShoppingCart, Sparkles, Store, Tag, Truck, Wallet,
  X,
} from 'lucide-react'
import {
  calculateShipping, calculateSplit, initialProducts, initialVehicle, isCompatible,
  optimizeImage, orderSteps,
  type OrderStatus, type Product, type Vehicle,
} from './services/mock'
import { loadClientGarage, lookupVehicle, uploadTenantMedia } from './services/supabase'

type Workspace = 'overview' | 'merchant' | 'storefront' | 'courier'
const money = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const titles: Record<Workspace, string> = {
  overview: 'Visão geral', merchant: 'Autopeças Horizonte', storefront: 'Vitrine da loja', courier: 'Central de entregas',
}

export default function App() {
  const [workspace, setWorkspace] = useState<Workspace>('overview')
  const [mobileNav, setMobileNav] = useState(false)
  const [products, setProducts] = useState(initialProducts)
  const [teamMembers, setTeamMembers] = useState([
    { name: 'Marina Alves', email: 'marina@horizonte.com.br', role: 'Administradora', initials: 'MA' },
    { name: 'Lucas Ferreira', email: 'lucas@horizonte.com.br', role: 'Entregador', initials: 'LF' },
    { name: 'Rafael Nunes', email: 'rafael@horizonte.com.br', role: 'Vendedor', initials: 'RN' },
  ])
  const [garage, setGarage] = useState<Vehicle[]>(() => {
    try {
      const saved = localStorage.getItem('vancely-client-garage-v1')
      return saved ? JSON.parse(saved) as Vehicle[] : [initialVehicle]
    } catch {
      return [initialVehicle]
    }
  })
  const [vehicle, setVehicle] = useState<Vehicle | null>(() => garage[0] ?? null)
  const [plate, setPlate] = useState('')
  const [lookupBusy, setLookupBusy] = useState(false)
  const [lookupMessage, setLookupMessage] = useState('')
  const [lookupCost, setLookupCost] = useState(0.21)
  const [status, setStatus] = useState<OrderStatus>('checking')
  const [acceptedRide, setAcceptedRide] = useState(false)
  const [locationTick, setLocationTick] = useState(0)
  const [cart, setCart] = useState<Record<string, number>>({ p1: 1, p2: 1 })
  const [cartOpen, setCartOpen] = useState(false)
  const [orderPlaced, setOrderPlaced] = useState(false)
  const [payment, setPayment] = useState('PIX')
  const [pickup, setPickup] = useState(false)
  const [distance, setDistance] = useState(4.2)
  const [freeRadius, setFreeRadius] = useState(3)
  const [banner, setBanner] = useState('')
  const [bannerSlide, setBannerSlide] = useState(0)
  const [mediaNote, setMediaNote] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!acceptedRide || status !== 'delivery') return
    const timer = window.setInterval(() => setLocationTick((current) => current + 1), 2500)
    return () => window.clearInterval(timer)
  }, [acceptedRide, status])

  useEffect(() => {
    if (garage.length) localStorage.setItem('vancely-client-garage-v1', JSON.stringify(garage))
    else localStorage.removeItem('vancely-client-garage-v1')
  }, [garage])

  useEffect(() => {
    let mounted = true
    void loadClientGarage().then((savedGarage) => {
      if (!mounted || !savedGarage) return
      setGarage(savedGarage)
      setVehicle(savedGarage[0] ?? null)
    }).catch(() => undefined)
    return () => { mounted = false }
  }, [])

  const compatibleProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    return products.filter((product) => {
      const matchesSearch = !term || `${product.name} ${product.category}`.toLowerCase().includes(term)
      return matchesSearch && (!vehicle || isCompatible(product, vehicle))
    })
  }, [products, search, vehicle])

  const cartItems = products.filter((product) => (cart[product.id] ?? 0) > 0)
  const subtotal = cartItems.reduce((sum, product) => sum + product.price * cart[product.id], 0)
  const shipping = calculateShipping(distance, freeRadius, pickup)
  const checkoutTotal = subtotal + shipping.price
  const split = calculateSplit(checkoutTotal)
  const activeStep = orderSteps.findIndex((step) => step.id === status)

  function updateQuantity(id: string, amount: number) {
    setCart((current) => ({ ...current, [id]: Math.max(0, (current[id] ?? 0) + amount) }))
  }

  async function submitPlate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLookupBusy(true)
    setLookupMessage('')
    try {
      const result = await lookupVehicle(plate)
      setVehicle(result.vehicle)
      setGarage((current) => [result.vehicle, ...current.filter((saved) => saved.plate !== result.vehicle.plate)])
      setLookupCost((cost) => Number((cost + result.cost).toFixed(2)))
      setLookupMessage(result.cacheHit ? 'Encontramos no cache. Consulta sem custo.' : 'Consulta concluída. Veículo salvo na sua garagem.')
      setPlate('')
    } catch (error) {
      setLookupMessage(error instanceof Error ? error.message : 'Não foi possível consultar a placa.')
    } finally {
      setLookupBusy(false)
    }
  }

  async function handleMedia(event: ChangeEvent<HTMLInputElement>, target: 'banner' | 'product') {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const result = await optimizeImage(file)
      const upload = await uploadTenantMedia(result.blob, result.url, target)
      if (target === 'banner') setBanner(upload.url)
      else setProducts((current) => current.map((item, index) => index === 0 ? { ...item, image: upload.url } : item))
      setMediaNote(`${result.format} · ${Math.round(result.size / 1024)} KB · ${upload.simulated ? 'modo simulação' : 'enviado ao Supabase Storage'}`)
      if (upload.url !== result.url) URL.revokeObjectURL(result.url)
    } catch (error) {
      setMediaNote(error instanceof Error ? error.message : 'Falha ao processar imagem.')
    }
    event.target.value = ''
  }

  function placeOrder() {
    setOrderPlaced(true)
    setStatus('approved')
    setCartOpen(false)
    setWorkspace('storefront')
  }

  const navItems: { id: Workspace; label: string; icon: typeof LayoutDashboard }[] = [
    { id: 'overview', label: 'Sistema Vancely', icon: LayoutDashboard },
    { id: 'merchant', label: 'Painel do lojista', icon: Store },
    { id: 'storefront', label: 'Loja B2C', icon: ShoppingBag },
    { id: 'courier', label: 'Motoboy', icon: Bike },
  ]

  return (
    <div className="app-shell">
      {mobileNav && <button className="nav-scrim" aria-label="Fechar menu" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup"><span className="brand-mark">V</span><span>vancely<span className="brand-light">software</span></span></div>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-select"><span className="tenant-icon">H</span><span><b>Horizonte Autopeças</b><small>Plano aceleração</small></span><ChevronDown size={15} /></div>
        <div className="nav-label">PLATAFORMA</div>
        <nav className="primary-nav" aria-label="Navegação principal">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button className={`nav-item ${workspace === id ? 'nav-active' : ''}`} key={id} onClick={() => { setWorkspace(id); setMobileNav(false) }}>
              <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{id === 'merchant' && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-link"><CircleHelp size={16} /><span>Central de ajuda</span><ArrowUpRight size={14} /></div>
          <div className="profile-row"><div className="avatar">MA</div><span><b>Marina Alves</b><small>Administradora</small></span><Settings2 size={16} /></div>
        </div>
      </aside>

      <main className="main-shell">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setMobileNav(true)}><Menu size={20} /></button>
          <div className="breadcrumbs"><span>Horizonte Autopeças</span><span className="crumb-slash">/</span><b>{titles[workspace]}</b></div>
          <div className="topbar-right"><span className="live-status"><i /> Operação ativa</span><button className="help-icon" aria-label="Ajuda"><CircleHelp size={18} /></button><div className="avatar top-avatar">MA</div></div>
        </header>

        {workspace === 'overview' && <section className="page-content">
          <div className="page-heading"><div><p className="eyebrow">SEXTA-FEIRA, 23 DE OUTUBRO DE 2026</p><h1>Bom dia, Marina <span>✳</span></h1><p className="heading-copy">Aqui está o resumo da sua operação hoje.</p></div><button className="button button-dark" onClick={() => setWorkspace('merchant')}><Plus size={16} /> Nova ação</button></div>
          <div className="metric-grid">
            <Metric label="Faturamento do mês" value="R$ 48.290,50" change="12,8%" icon={Wallet} tone="green" detail="vs. mês anterior" />
            <Metric label="Pedidos hoje" value="38" change="8,2%" icon={ShoppingBag} tone="orange" detail="vs. ontem" />
            <Metric label="Ticket médio" value="R$ 186,40" change="4,1%" icon={Tag} tone="blue" detail="vs. mês anterior" />
            <Metric label="Consultas de placa" value="126" change="84% cache" icon={CarFront} tone="violet" detail={`${money(lookupCost)} em custo simulado`} />
          </div>
          <div className="overview-grid">
            <section className="panel revenue-panel"><div className="panel-heading"><div><p className="eyebrow">DESEMPENHO</p><h2>Receita da operação</h2></div><button className="select-button">Últimos 7 dias <ChevronDown size={14} /></button></div><div className="revenue-summary"><strong>R$ 12.840,00</strong><span className="positive"><ArrowUpRight size={14} /> 12,8%</span><span className="muted">na última semana</span></div><div className="chart-area"><div className="chart-y"><span>4 mil</span><span>3 mil</span><span>2 mil</span><span>1 mil</span></div><div className="chart"><div className="chart-lines"><i /><i /><i /><i /></div><svg viewBox="0 0 700 170" preserveAspectRatio="none" aria-label="Gráfico de receita semanal"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c8e653" stopOpacity=".34" /><stop offset="1" stopColor="#c8e653" stopOpacity="0" /></linearGradient></defs><path d="M0 132 C36 126 48 144 84 114 S135 112 171 91 S229 120 263 87 S321 92 350 70 S406 88 438 52 S498 71 528 60 S583 83 615 38 S671 50 700 20 V170 H0Z" fill="url(#chartFill)" /><path d="M0 132 C36 126 48 144 84 114 S135 112 171 91 S229 120 263 87 S321 92 350 70 S406 88 438 52 S498 71 528 60 S583 83 615 38 S671 50 700 20" fill="none" stroke="#819e24" strokeWidth="3" vectorEffect="non-scaling-stroke" /></svg><div className="chart-x"><span>Seg, 19</span><span>Ter, 20</span><span>Qua, 21</span><span>Qui, 22</span><span>Sex, 23</span><span>Sáb, 24</span><span>Dom, 25</span></div></div></div></section>
            <section className="panel activity-panel"><div className="panel-heading"><div><p className="eyebrow">AGORA</p><h2>Atividade recente</h2></div><button className="text-button" onClick={() => setWorkspace('merchant')}>Ver pedidos <ArrowRight size={14} /></button></div><ActivityRow icon={ShoppingBag} title="Novo pedido recebido" subtitle="#VH-2841 · há 4 min" value="R$ 324,90" tone="green" /><ActivityRow icon={CarFront} title="Consulta de placa" subtitle="Cache hit · Uno 2018" value="R$ 0,00" tone="blue" /><ActivityRow icon={BadgeCheck} title="Plano renovado" subtitle="Auto Peças Central · há 1 h" value="R$ 299,00" tone="orange" /><ActivityRow icon={Truck} title="Entrega concluída" subtitle="#VH-2838 · há 2 h" value="R$ 18,50" tone="violet" /></section>
          </div>
          <section className="panel orders-panel"><div className="panel-heading"><div><p className="eyebrow">ACOMPANHAMENTO</p><h2>Pedidos em andamento</h2></div><button className="text-button" onClick={() => setWorkspace('merchant')}>Todos os pedidos <ArrowRight size={14} /></button></div><OrderTable status={status} onAdvance={() => setStatus((current) => orderSteps[Math.min(orderSteps.findIndex((step) => step.id === current) + 1, orderSteps.length - 1)].id)} /></section>
          <section className="billing-panel panel"><div className="panel-heading"><div><p className="eyebrow">SISTEMA PAI · VANCELY</p><h2>Lojistas e faturamento de planos</h2></div><button className="button button-outline" onClick={() => setWorkspace('merchant')}>Gerenciar planos <ArrowRight size={14} /></button></div><div className="billing-layout"><div className="table-wrap billing-table"><table><thead><tr><th>LOJISTA</th><th>PLANO</th><th>STATUS</th><th>PRÓXIMA COBRANÇA</th><th>VALOR MENSAL</th></tr></thead><tbody><tr><td><b>Horizonte Autopeças</b><small>horizonte.vancely.app</small></td><td>Aceleração</td><td><span className="subscription-status">Ativa</span></td><td>23 nov, 2026</td><td><b>R$ 299,00</b></td></tr><tr><td><b>Auto Peças Central</b><small>central.vancely.app</small></td><td>Essencial</td><td><span className="subscription-status">Ativa</span></td><td>25 nov, 2026</td><td><b>R$ 149,00</b></td></tr><tr><td><b>Peças do Vale</b><small>pecasdovale.vancely.app</small></td><td>Rede</td><td><span className="subscription-trial">Em teste</span></td><td>02 dez, 2026</td><td><b>R$ 599,00</b></td></tr></tbody></table></div><div className="plan-summary"><p className="eyebrow">PLANOS DISPONÍVEIS</p><div><span><i className="plan-dot plan-basic" /> Essencial</span><b>R$ 149 <small>/mês</small></b></div><div><span><i className="plan-dot plan-grow" /> Aceleração</span><b>R$ 299 <small>/mês</small></b></div><div><span><i className="plan-dot plan-network" /> Rede</span><b>R$ 599 <small>/mês</small></b></div><p className="plan-footnote">3 lojistas · MRR <b>R$ 1.047,00</b></p></div></div></section>
        </section>}

        {workspace === 'merchant' && <section className="page-content">
          <div className="page-heading"><div><p className="eyebrow">PAINEL DO LOJISTA</p><h1>Olá, Marina</h1><p className="heading-copy">Sua loja vende em 3 canais e está com tudo em dia.</p></div><button className="button button-dark" onClick={() => document.getElementById('product-upload')?.click()}><ImagePlus size={16} /> Otimizar imagem</button><input id="product-upload" type="file" accept="image/*" hidden onChange={(event) => handleMedia(event, 'product')} /></div>
          <div className="merchant-tabs"><button className="tab-active">Visão geral</button><button onClick={() => document.getElementById('product-table')?.scrollIntoView({ behavior: 'smooth' })}>Produtos <span>42</span></button><button onClick={() => document.getElementById('merchant-orders')?.scrollIntoView({ behavior: 'smooth' })}>Pedidos <span>8</span></button><button onClick={() => document.getElementById('freight-panel')?.scrollIntoView({ behavior: 'smooth' })}>Entrega</button></div>
          <div className="metric-grid merchant-metrics"><Metric label="Pedidos a preparar" value="8" change="3 urgentes" icon={Box} tone="orange" detail="1 pedido em conferência" /><Metric label="Produtos ativos" value="428" change="12 sem estoque" icon={PackageCheck} tone="green" detail="catálogo atualizado" /><Metric label="Vendas hoje" value="R$ 3.840" change="+18,4%" icon={Activity} tone="blue" detail="em 21 pedidos" /><Metric label="Nota da loja" value="4,9" change="Excelente" icon={BadgeCheck} tone="violet" detail="de 5 · 182 avaliações" /></div>
          <div className="merchant-columns"><section id="merchant-orders" className="panel"><div className="panel-heading"><div><p className="eyebrow">PRECISAM DE ATENÇÃO</p><h2>Fila de pedidos</h2></div><span className="small-count">3 novos</span></div><OrderTable status={status} onAdvance={() => setStatus((current) => orderSteps[Math.min(orderSteps.findIndex((step) => step.id === current) + 1, orderSteps.length - 1)].id)} /></section>
            <section id="freight-panel" className="panel freight-panel"><div className="panel-heading"><div><p className="eyebrow">CONFIGURAÇÃO DA LOJA</p><h2>Regras de entrega</h2></div><button className="icon-button"><Settings2 size={17} /></button></div><label className="field-label" htmlFor="free-radius">Frete grátis até</label><div className="input-with-suffix"><input id="free-radius" type="number" min="0" value={freeRadius} onChange={(event) => setFreeRadius(Math.max(0, Number(event.target.value)))} /><span>km</span></div><div className="rate-line"><span>Entrega expressa</span><b>R$ 2,50 <small>/ km</small></b></div><div className="rate-line"><span>Retirada no balcão</span><b>Grátis</b></div><div className="freight-preview"><MapPin size={17} /><span>Entrega de teste a {distance.toFixed(1)} km</span><strong>{money(calculateShipping(distance, freeRadius, false).price)}</strong></div><input className="range-input" aria-label="Distância simulada" type="range" min="1" max="20" step="0.5" value={distance} onChange={(event) => setDistance(Number(event.target.value))} /><div className="range-labels"><span>1 km</span><span>20 km</span></div></section></div>
          <div className="merchant-columns lower-merchant"><section id="product-table" className="panel product-panel"><div className="panel-heading"><div><p className="eyebrow">ESTOQUE E CATÁLOGO</p><h2>Produtos recentes</h2></div><button className="text-button" onClick={() => setWorkspace('storefront')}>Ver na vitrine <ArrowRight size={14} /></button></div>{mediaNote && <p className="inline-note"><Check size={14} /> {mediaNote}</p>}<ProductTable products={products} /></section><section className="panel banner-panel"><div className="panel-heading"><div><p className="eyebrow">VITRINE DIGITAL</p><h2>Banner da campanha</h2></div><Sparkles size={17} /></div><div className="campaign-banner" style={banner ? { backgroundImage: `linear-gradient(90deg, rgba(20,30,27,.76), rgba(20,30,27,.06)), url(${banner})` } : undefined}><div><span>SEMANA DO MOTORISTA</span><b>Seu carro<br />merece cuidado.</b><small>Até 25% em itens selecionados</small></div>{!banner && <div className="banner-art"><span>25</span><small>% OFF</small></div>}</div><label className="button button-outline banner-upload"><ImagePlus size={15} /> Carregar banner<input type="file" accept="image/*" hidden onChange={(event) => handleMedia(event, 'banner')} /></label><p className="microcopy">Upload otimizado em WebP antes de enviar ao Storage.</p></section></div>
          <section className="panel team-panel"><div className="panel-heading"><div><p className="eyebrow">ACESSO À LOJA</p><h2>Equipe e permissões</h2></div><button className="button button-outline" onClick={() => setTeamMembers((current) => current.some((member) => member.email === 'novo@horizonte.com.br') ? current : [...current, { name: 'Novo membro', email: 'novo@horizonte.com.br', role: 'Vendedor', initials: 'NM' }])}><Plus size={14} /> Adicionar membro</button></div><div className="team-list">{teamMembers.map((member) => <div className="team-member" key={member.email}><span className="team-avatar">{member.initials}</span><span className="team-person"><b>{member.name}</b><small>{member.email}</small></span><select aria-label={`Permissão de ${member.name}`} value={member.role} onChange={(event) => setTeamMembers((current) => current.map((item) => item.email === member.email ? { ...item, role: event.target.value } : item))}><option>Administradora</option><option>Gerente</option><option>Vendedor</option><option>Entregador</option></select></div>)}</div></section>
        </section>}

        {workspace === 'storefront' && <section className="storefront-page">
          <div className="storefront-top"><div className="store-brand"><span className="store-logo">H</span><span><b>Horizonte</b><small>AUTOPEÇAS · DESDE 1998</small></span><span className="store-open"><i /> Aberta</span></div><div className="store-actions"><button className="icon-button"><Search size={18} /></button><button className="icon-button cart-trigger" aria-label="Abrir carrinho" onClick={() => setCartOpen(true)}><ShoppingCart size={18} /><span>{Object.values(cart).reduce((sum, count) => sum + count, 0)}</span></button><div className="avatar customer-avatar">LC</div></div></div>
          <div className="store-content"><div className="store-hero" style={banner && bannerSlide === 2 ? { backgroundImage: `linear-gradient(90deg, rgba(20,30,27,.82), rgba(20,30,27,.16)), url(${banner})` } : undefined}><div><span className="hero-kicker">{['PEÇA CERTA. SEM COMPLICAÇÃO.', 'CUIDADO QUE MOVE VOCÊ.', 'OFERTA DA SEMANA'][bannerSlide]}</span><h1>{bannerSlide === 1 ? <>Manutenção em dia.<br /><em>Viagem tranquila.</em></> : <>Seu carro pede.<br /><em>A gente encontra.</em></>}</h1><p>{bannerSlide === 1 ? 'Qualidade e confiança para seguir em frente.' : bannerSlide === 2 ? 'Confira as condições especiais da nossa campanha.' : 'Encontre peças compatíveis com seu veículo e receba hoje.'}</p><button className="button hero-button" onClick={() => document.getElementById('catalog-search')?.focus()}>Explorar catálogo <ArrowRight size={16} /></button></div><div className="hero-graphic"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="part-shape"><Gauge size={82} strokeWidth={1.1} /></div><span className="floating-tag tag-one">100% compatível</span><span className="floating-tag tag-two">Entrega hoje</span></div><div className="hero-controls"><button aria-label="Banner anterior" onClick={() => setBannerSlide((slide) => (slide + 2) % 3)}><ChevronLeft size={14} /></button><span>{[0, 1, 2].map((slide) => <i className={bannerSlide === slide ? 'hero-dot-active' : ''} key={slide} />)}</span><button aria-label="Próximo banner" onClick={() => setBannerSlide((slide) => (slide + 1) % 3)}><ChevronRight size={14} /></button></div></div>
            <div className="plate-panel"><div className="plate-icon"><CarFront size={22} /></div><div className="plate-copy"><b>Encontre peças para o seu carro</b><span>Busque pela placa ou selecione na sua garagem.</span></div><form className="plate-form" onSubmit={submitPlate}><input aria-label="Placa do veículo" placeholder="ABC1D23" maxLength={7} value={plate} onChange={(event) => setPlate(event.target.value.toUpperCase())} /><button className="button button-dark" disabled={lookupBusy}>{lookupBusy ? <span className="spinner" /> : <Search size={15} />}{lookupBusy ? 'Consultando' : 'Buscar'}</button></form></div>
            {lookupMessage && <div className="lookup-note"><Check size={15} />{lookupMessage}</div>}
            <div className="store-section-heading"><div><p className="eyebrow">SUA GARAGEM</p><h2>Carros salvos</h2></div><span className="saved-count">{garage.length} {garage.length === 1 ? 'veículo' : 'veículos'}</span></div>
            {garage.length ? <div className="garage-list">{garage.map((saved) => <div className={`garage-card ${vehicle?.plate === saved.plate ? 'garage-card-selected' : ''}`} key={saved.plate} onClick={() => setVehicle(saved)}><div className="garage-car-icon"><CarFront size={27} /></div><div className="garage-details"><b>{saved.make} {saved.model} <span>{saved.year}</span></b><small>{saved.engine} · Placa {saved.plate}</small></div>{vehicle?.plate === saved.plate ? <span className="garage-active"><i /> Selecionado</span> : <button className="garage-select" onClick={() => setVehicle(saved)}>Usar este carro</button>}<button className="icon-button garage-remove" aria-label={`Remover ${saved.model} da garagem`} onClick={(event) => { event.stopPropagation(); setGarage((current) => current.filter((item) => item.plate !== saved.plate)); if (vehicle?.plate === saved.plate) setVehicle(null) }}><X size={16} /></button></div>)}</div> : <div className="empty-garage">Consulte uma placa para salvar seu primeiro veículo na garagem.</div>}
            <div className="catalog-header"><div><p className="eyebrow">CATÁLOGO DA LOJA</p><h2>Peças para você</h2></div><label className="catalog-search"><Search size={16} /><input id="catalog-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar peça ou categoria" /></label></div>
            <div className="product-grid">{compatibleProducts.length ? compatibleProducts.map((product) => <article className="store-product" key={product.id}><div className="product-photo"><img src={product.image} alt={product.name} /><span className="stock-pill">Em estoque</span></div><div className="store-product-body"><span className="product-category">{product.category}</span><h3>{product.name}</h3>{vehicle && <span className="compatibility"><BadgeCheck size={13} /> Compatível com seu {vehicle.model} {vehicle.year}</span>}<div className="product-buy"><b>{money(product.price)}</b><button aria-label={`Adicionar ${product.name}`} onClick={() => { updateQuantity(product.id, 1); setCartOpen(true) }}><Plus size={17} /></button></div></div></article>) : <div className="empty-results">Nenhuma peça compatível encontrada para este veículo.</div>}</div>
            <div className="delivery-strip"><div><Truck size={20} /><span><b>Entrega rápida</b><small>Hoje para sua região</small></span></div><div><ShieldCheck size={20} /><span><b>Compra protegida</b><small>Pagamento seguro</small></span></div><div><PackageCheck size={20} /><span><b>Peça garantida</b><small>Procedência verificada</small></span></div></div>
            <section className="tracking-panel"><div className="panel-heading"><div><p className="eyebrow">ACOMPANHE SEU PEDIDO</p><h2>{orderPlaced ? 'Pedido #VH-2841' : 'Pedido #VH-2839'}</h2></div><span className="order-state"><i />{orderSteps[activeStep]?.label}</span></div><div className="timeline">{orderSteps.map((step, index) => <div className={`timeline-step ${index <= activeStep ? 'step-done' : ''} ${index === activeStep ? 'step-current' : ''}`} key={step.id}><span className="timeline-node">{index < activeStep ? <Check size={13} /> : index + 1}</span><div><b>{step.label}</b><small>{index < activeStep ? 'Concluído' : index === activeStep ? 'Em andamento' : 'Aguardando'}</small></div></div>)}</div>{status === 'delivery' && <div className="live-location"><span className="pulse-dot" /> Motoboy a caminho · localização atualizada há poucos segundos</div>}</section>
          </div>
          {cartOpen && <div className="drawer-backdrop" onClick={() => setCartOpen(false)}><aside className="cart-drawer" onClick={(event) => event.stopPropagation()}><div className="drawer-heading"><div><p className="eyebrow">SUA COMPRA</p><h2>{orderPlaced ? 'Pedido confirmado' : 'Carrinho'}</h2></div><button className="icon-button" onClick={() => setCartOpen(false)} aria-label="Fechar carrinho"><X size={19} /></button></div>{orderPlaced ? <div className="success-checkout"><span><Check size={25} /></span><h3>Pedido feito com sucesso</h3><p>Pedido #VH-2841 · pagamento via {payment}</p><button className="button button-dark" onClick={() => setCartOpen(false)}>Acompanhar pedido</button></div> : <><div className="drawer-items">{cartItems.map((product) => <div className="cart-row" key={product.id}><img src={product.image} alt="" /><div className="cart-item-info"><b>{product.name}</b><small>{money(product.price)}</small><div className="quantity"><button aria-label="Diminuir quantidade" onClick={() => updateQuantity(product.id, -1)}><Minus size={13} /></button><span>{cart[product.id]}</span><button aria-label="Aumentar quantidade" onClick={() => updateQuantity(product.id, 1)}><Plus size={13} /></button></div></div><strong>{money(product.price * cart[product.id])}</strong></div>)}{!cartItems.length && <p className="empty-cart">Seu carrinho está vazio.</p>}</div><div className="checkout-controls"><label className="field-label" htmlFor="distance">Distância estimada</label><div className="input-with-suffix"><input id="distance" type="number" min="0" step="0.5" value={distance} onChange={(event) => setDistance(Math.max(0, Number(event.target.value)))} /><span>km</span></div><label className="pickup-option"><input type="checkbox" checked={pickup} onChange={(event) => setPickup(event.target.checked)} /> Retirar no balcão <span>Grátis</span></label><label className="field-label payment-label">Forma de pagamento</label><div className="payment-options">{['PIX', 'Cartão', 'Boleto'].map((method) => <button className={payment === method ? 'payment-selected' : ''} key={method} onClick={() => setPayment(method)}>{method === 'PIX' ? <Sparkles size={15} /> : method === 'Cartão' ? <CreditCard size={15} /> : <Wallet size={15} />}{method}</button>)}</div><div className="checkout-line"><span>Subtotal</span><b>{money(subtotal)}</b></div><div className="checkout-line"><span>{shipping.method}</span><b>{money(shipping.price)}</b></div><div className="checkout-line total-line"><span>Total</span><b>{money(checkoutTotal)}</b></div><div className="split-hint"><ShieldCheck size={14} /> Pagamento protegido pela Vancely</div><button className="button button-dark checkout-button" disabled={!cartItems.length} onClick={placeOrder}>Confirmar pedido <ArrowRight size={16} /></button><p className="microcopy split-detail">Split simulado: taxa Vancely {money(split.serviceFee)} · loja recebe {money(split.merchantAmount)}</p></div></>}</aside></div>}
        </section>}

        {workspace === 'courier' && <section className="page-content courier-page">
          <div className="page-heading"><div><p className="eyebrow">APP DO ENTREGADOR</p><h1>Boa tarde, Lucas</h1><p className="heading-copy">Você está online e pronto para novas entregas.</p></div><span className="courier-online"><i /> Disponível</span></div>
          <div className="courier-stats"><div><span>Entregas hoje</span><b>12</b><small><ArrowUpRight size={13} /> +2 vs. ontem</small></div><div><span>Ganhos do dia</span><b>R$ 186,50</b><small>Última entrega há 18 min</small></div><div><span>Avaliação</span><b>4,98 <span className="star">★</span></b><small>de 5 · 240 entregas</small></div></div>
          <div className="courier-grid"><section className="panel ride-panel"><div className="panel-heading"><div><p className="eyebrow">CORRIDA ATUAL</p><h2>{acceptedRide ? 'Entrega em andamento' : 'Nova corrida disponível'}</h2></div><span className="ride-amount">R$ 18,50</span></div><div className="ride-map"><div className="map-grid" /><div className="map-road road-a" /><div className="map-road road-b" /><div className="map-road road-c" /><div className="map-route"><span className="route-origin"><Store size={14} /></span><span className="route-line" /><span className="route-destination"><MapPin size={15} /></span><span className="courier-marker" style={{ left: `${18 + (locationTick % 6) * 10}%` }}><Bike size={17} /></span></div><div className="map-label map-label-a">R. das Palmeiras</div><div className="map-label map-label-b">Av. Brasil</div><div className="map-label map-label-c">Centro</div><div className="map-legend"><span><i className="legend-shop" /> Loja</span><span><i className="legend-home" /> Cliente</span></div></div><div className="route-stops"><div className="route-stop"><span className="stop-icon pickup-icon"><Store size={15} /></span><span><small>RETIRAR</small><b>Horizonte Autopeças</b><em>Av. Brasil, 1240 · Centro</em></span><strong>1,2 km</strong></div><div className="route-connector" /><div className="route-stop"><span className="stop-icon drop-icon"><MapPin size={15} /></span><span><small>ENTREGAR PARA</small><b>Carolina Mendes</b><em>R. das Palmeiras, 84 · Vila Nova</em></span><strong>4,2 km</strong></div></div><div className="ride-footer"><div><Clock3 size={16} /><span><b>~ 18 min</b><small>tempo estimado</small></span></div><div><MapPin size={16} /><span><b>5,4 km</b><small>distância total</small></span></div>{!acceptedRide ? <button className="button button-dark" onClick={() => { setAcceptedRide(true); setStatus('delivery') }}>Aceitar corrida <ArrowRight size={15} /></button> : <button className="button button-lime" onClick={() => { setStatus('delivered'); setAcceptedRide(false) }}><Check size={16} /> Confirmar entrega</button>}</div>{acceptedRide && <div className="live-location courier-live"><span className="pulse-dot" /> Enviando localização em tempo real · ponto {locationTick + 1}</div>}</section>
            <aside className="courier-side"><section className="panel courier-order"><p className="eyebrow">DETALHES DO PEDIDO</p><div className="courier-order-title"><h2>#VH-2839</h2><span className="order-state"><i />{orderSteps[activeStep]?.label}</span></div><div className="courier-line"><span>Itens</span><b>2 produtos</b></div><div className="courier-line"><span>Pagamento</span><b>PIX · pago</b></div><div className="courier-line"><span>Valor dos produtos</span><b>R$ 224,40</b></div><div className="courier-line"><span>Taxa de entrega</span><b>R$ 18,50</b></div><div className="courier-line courier-total"><span>Total do pedido</span><b>R$ 242,90</b></div><button className="button button-outline full-button"><CircleHelp size={15} /> Preciso de ajuda</button></section><section className="courier-tip"><span><Sparkles size={17} /></span><div><b>Boa sequência!</b><p>Você está entre os entregadores mais bem avaliados da região.</p></div></section></aside></div>
        </section>}
        <footer className="page-footer"><span>Vancely Software <b>·</b> Ambiente de simulação</span><span>Todos os dados desta demonstração são fictícios.</span></footer>
      </main>
    </div>
  )
}

function Metric({ label, value, change, icon: Icon, tone, detail }: { label: string; value: string; change: string; icon: typeof Wallet; tone: string; detail: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span><span className={`metric-icon tone-${tone}`}><Icon size={17} /></span></div><div className="metric-value">{value}</div><div className="metric-bottom"><span className={`metric-change ${tone === 'orange' ? 'change-neutral' : ''}`}>{tone === 'orange' ? <ArrowDownRight size={13} /> : <ArrowUpRight size={13} />}{change}</span><span>{detail}</span></div></article>
}

function ActivityRow({ icon: Icon, title, subtitle, value, tone }: { icon: typeof Wallet; title: string; subtitle: string; value: string; tone: string }) {
  return <div className="activity-row"><span className={`activity-icon tone-${tone}`}><Icon size={16} /></span><span className="activity-copy"><b>{title}</b><small>{subtitle}</small></span><strong>{value}</strong></div>
}

function OrderTable({ status, onAdvance }: { status: OrderStatus; onAdvance: () => void }) {
  const activeLabel = orderSteps.find((step) => step.id === status)?.label ?? 'Em separação'
  return <div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Cliente</th><th>Itens</th><th>Valor</th><th>Status</th><th></th></tr></thead><tbody><tr><td><b>#VH-2841</b><small>Hoje, 14:32</small></td><td>Carolina Mendes</td><td>2 itens</td><td><b>R$ 324,90</b></td><td><span className="table-status status-progress"><i />{activeLabel}</span></td><td><button className="row-action" aria-label="Avançar pedido" onClick={onAdvance}><ArrowRight size={15} /></button></td></tr><tr><td><b>#VH-2840</b><small>Hoje, 14:18</small></td><td>Rafael Costa</td><td>4 itens</td><td><b>R$ 618,00</b></td><td><span className="table-status status-new"><i />Novo pedido</span></td><td><button className="row-action" aria-label="Ver pedido"><ArrowRight size={15} /></button></td></tr><tr><td><b>#VH-2839</b><small>Hoje, 13:55</small></td><td>Mariana Souza</td><td>2 itens</td><td><b>R$ 242,90</b></td><td><span className="table-status status-delivery"><i />Com entregador</span></td><td><button className="row-action" aria-label="Ver pedido"><ArrowRight size={15} /></button></td></tr></tbody></table></div>
}

function ProductTable({ products }: { products: Product[] }) {
  return <div className="table-wrap"><table><thead><tr><th>Produto</th><th>Categoria</th><th>Aplicação</th><th>Estoque</th><th>Preço</th></tr></thead><tbody>{products.slice(0, 4).map((product) => <tr key={product.id}><td><span className="table-product"><img src={product.image} alt="" /><b>{product.name}</b></span></td><td>{product.category}</td><td>{product.makes.join(', ')} · {product.models.slice(0, 2).join(', ')}</td><td><span className={product.stock < 10 ? 'stock-low' : 'stock-ok'}>{product.stock} un.</span></td><td><b>{money(product.price)}</b></td></tr>)}</tbody></table></div>
}