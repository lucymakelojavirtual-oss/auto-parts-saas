# Vancely Software

Portal inicial da plataforma SaaS Vancely com contextos separados para administração, lojistas, vitrine e entregadores. Login, cadastro, autorização por perfil e chamados usam Supabase; módulos que dependem de integrações operacionais permanecem desabilitados até a configuração das respectivas APIs.

## Rodar localmente

```sh
npm install
cp .env.example .env.local
npm run dev
```

Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores públicos do projeto Supabase. Nunca coloque uma chave `service_role` em variáveis `VITE_*` ou no navegador. Os contatos em `VITE_SUPPORT_WHATSAPP` (somente dígitos internacionais, com DDI e DDD) e `VITE_SUPPORT_EMAIL` vêm preenchidos com os canais informados pela Vancely e podem ser alterados por ambiente.

## Supabase e autenticação

1. Aplique em sequência as migrações de `supabase/migrations/`.
2. Cadastre e ative no banco os planos **Essencial**, **Aceleração** e **Sede**, com preços e limites aprovados pela Vancely. O formulário de cadastro lista os planos ativos; não há preço comercial fixado nesta base.
3. Ative a confirmação de e-mail no Supabase Auth para produção e configure os URLs de redirecionamento do projeto para os domínios da aplicação.
4. Cadastre o perfil Master Admin como `admin_master` em `app_metadata` através de um processo administrativo confiável, usando a API Admin do Supabase apenas no servidor. Nunca permita que o navegador atribua esse perfil.
5. Revise juridicamente os termos exibidos no cadastro antes de iniciar a operação comercial.

A migração `20261027000000_setup_admin_master.sql` associa o e-mail Master Admin confirmado ao perfil `admin_master` em `app_metadata`, usado pelas políticas RLS e pelo app. Antes de aplicá-la, crie a conta no Supabase Auth e confirme o e-mail. A migração não cria senha nem grava credenciais; defina uma senha forte e exclusiva pelo fluxo seguro do Supabase Auth. Ela também atribui o perfil a contas futuras desse e-mail apenas depois da confirmação, inclusive se criadas por OAuth.

Rotas disponíveis:

- `/admin/login` e `/admin`: autenticação e área restrita da equipe Vancely.
- `/registrar`: onboarding da loja, plano, aceite e criação transacional de tenant, membership e assinatura.
- `/login` e `/app`: acesso da equipe da loja, com encaminhamento por perfil.
- `/loja/:slug`: ponto de entrada público da vitrine.
- `/entregador`: área protegida do entregador.

O cadastro é concluído pelo RPC `complete_tenant_registration`; se o Supabase exigir confirmação por e-mail, os dados de onboarding permanecem nos metadados da conta e a criação da loja é finalizada após o primeiro login confirmado. O RPC valida o plano ativo, o CNPJ e o aceite antes de gravar a loja. O formulário apresenta os termos completos da versão `2026-10-23-v1`, e a migração `20261025000000_terms_version.sql` registra a versão aceita junto à loja e valida a versão no servidor.

O chat apresenta triagem inicial e, quando solicitado, persiste chamados e mensagens no Supabase com RLS e Supabase Realtime. Para operação real, configure também os contatos opcionais de suporte.

## Planos e comissão

Aplique `20261026000000_plan_commissions.sql` depois das migrações anteriores. Ela cadastra/atualiza os planos Essencial (R$ 149/mês, 4%), Aceleração (R$ 299/mês, 2,5%) e Sede (R$ 699/mês, 1,5%), com os limites de produtos, NF-e, vendedores e motoboys. O cadastro da loja exibe os principais limites e a comissão do plano.

Quando um pedido é marcado como pago pelo backend, o trigger consulta o plano vigente da loja e cria uma linha idempotente em `transactions_split`, calculando a comissão sobre o subtotal dos produtos (sem frete). O split fica `pending` até o provedor de pagamento efetuar a liquidação. Esta base ainda não integra gateway nem transfere valores para a conta Master da Vancely; essa etapa exige uma função server-side com o provedor e os identificadores de conta/split configurados. Não marque pedidos como pagos pelo cliente/navegador.

## Frete, créditos e catálogo

Aplique `20261030000000_delivery_wallet_catalog.sql` depois das migrações anteriores. Ela habilita a configuração de frete grátis por distância e preço por quilômetro excedente, recalcula o frete e o total do pedido no banco e mantém a comissão do Software Pai incidente somente sobre o subtotal, sem comissão sobre frete. A migração `20261031000000_delivery_route_cache.sql` protege o cache de rotas para leitura/escrita apenas pelo servidor e cria a chave única por loja e CEP.

Implante a Edge Function (`supabase functions deploy quote-delivery`) após aplicar a migração `20261031000002_osm_routes_and_trial_storefronts.sql`. Em cache miss, a função geocodifica os CEPs de origem e destino no Nominatim (com `User-Agent: VancelySaaS-App/1.0`), calcula o trajeto no OSRM, grava distância, duração e geometria na tabela `delivery_routes_cache` e calcula o preço pelas regras existentes do lojista. O cache usa a loja e os CEPs normalizados de origem e destino. A vitrine renderiza o trajeto em Leaflet com tiles do OpenStreetMap. Lojas em status `trial` também podem abrir a vitrine e cotar entregas para validação.

A vitrine permite cotar a entrega por CEP. Ainda não existe fluxo de carrinho/finalização de pedido ou integração de pagamentos nesta base; portanto, a cotação não cria pedido nem liquida/reserva valores no gateway. Quando o pedido existente for criado pelo backend com a distância da rota e marcado como pago, o trigger já registra o split do plano sobre o subtotal (frete excluído).

A mesma migração adiciona saldo cumulativo de créditos avulsos de placas e créditos adicionais de NF-e vinculados ao ciclo atual da assinatura. `monthly_plate_limit` é a cota mensal configurável de placas do plano (inicia em zero para não inventar limites comerciais). A cota mensal do plano e o uso de NF-e são renovados pelo período da assinatura existente; os créditos adicionais de NF-e são zerados quando esse período muda. Consultas de placas consomem primeiro a cota mensal e depois o saldo adicional persistente. O RPC `grant_tenant_credits` só pode ser chamado com `service_role`, após confirmação de pagamento server-side, e usa referência de pagamento idempotente. O frontend mostra as cotas e saldos, mas não inicia compras PIX porque esta aplicação ainda não integra um gateway.

O painel `/app` agora oferece cadastro, edição e exclusão de produtos para lojistas; vendedores (`staff`) podem cadastrar e editar, mas não excluir nem alterar configurações da loja. As regras equivalentes são aplicadas por RLS. Fotos de produtos e logomarcas são reduzidas para no máximo 800 px de largura e convertidas para WebP antes do upload ao bucket `tenant-media`.

## Central Vancely e identidade white-label

A migração `20261028000000_master_analytics_branding.sql` reutiliza as tabelas existentes para fornecer o RPC de métricas da Central Vancely, índices para consultas por loja/período, compatibilidade RLS com os perfis `admin_master` e `vancely_admin`, e atualização validada da identidade visual da loja. Aplique-a após as migrações anteriores.

O painel calcula vendas pagas, entregas, fretes, splits por plano e consultas de placas a partir de `orders`, `transactions_split` e `plate_lookup_events`. A taxa de R$ 0,03 por consulta em cache é apresentada como estimativa de faturamento; o custo de API utiliza o campo `simulated_cost` que já existe. As cotas de placas agora são configuradas por `plans.monthly_plate_limit`. As renovações no gráfico são previsões baseadas em `current_period_end`, não pagamentos do gateway.

O fluxo de cadastro já cria loja, associação, assinatura e regra de entrega, e as rotas compartilhadas existentes atendem lojista/vendedor (`/app`), motoboy (`/entregador`) e cliente (`/loja/:slug`). A personalização do lojista salva nome, cor, frase e logomarca no bucket `tenant-media` já existente. Aplique também `20261031000001_promotional_storefront_banners.sql` após as migrações anteriores para persistir até cinco banners promocionais e exibi-los na vitrine pública. As imagens dos banners são reduzidas a no máximo 1600 px e convertidas para WebP antes do upload. Não há provisionamento de três instalações PWA independentes nem ícones white-label dinâmicos neste frontend.

Esta base ainda não registra compras de blocos de estoque/NF-e adicionais, custos de chamadas de geocodificação/roteirização ou eventos de cobrança e renovação do gateway; o painel não inventa nem duplica essas receitas. A integração desses módulos exige conexão backend e persistência própria antes de exibir valores reais.

## Acesso do Admin Master às lojas

Aplique `20261029000000_master_tenant_access.sql` depois da migração de métricas. Ela amplia os helpers RLS já usados pelas políticas de tenant para que a role confiável `admin_master` possa ler e administrar tenants existentes e cria o RPC autenticado `get_master_tenant_by_slug` para abrir uma loja sem trocar a sessão do administrador.

Na Central Vancely, o seletor de lojas e as ações da lista abrem `/app/:slug`, `/driver/:slug` e `/loja/:slug`. As duas primeiras rotas exigem uma sessão com `app_metadata.role` autorizada; a vitrine mantém acesso público apenas a lojas ativas e produtos publicados. Nenhum acesso administrativo é concedido por `user_metadata` ou por e-mail informado pelo navegador: atribua `admin_master` exclusivamente por processo confiável no servidor/Supabase Auth.

## Integrações pendentes

As integrações Focus NFe, API de placas/cache e pagamentos ainda dependem de backend. A cotação de rota da vitrine usa a Edge Function `quote-delivery` e a tabela `delivery_routes_cache`; criação de pedidos e processamento de pagamentos continuam pendentes.

## Verificação

```sh
npm run build
```
