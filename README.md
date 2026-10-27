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

Quando um pedido é marcado como pago pelo webhook do Asaas, o trigger consulta o plano vigente da loja e cria uma linha idempotente em `transactions_split`, calculando a comissão sobre o subtotal dos produtos (sem frete). O Asaas divide o recebimento entre a carteira cadastrada da loja e a conta da plataforma; a linha financeira interna permanece `pending` até a conciliação de liquidação. O valor interno é uma estimativa sobre o bruto e deve ser conciliado com taxas e valores líquidos do provedor. Não marque pedidos como pagos pelo cliente/navegador.

## Frete, créditos e catálogo

Aplique `20261030000000_delivery_wallet_catalog.sql` depois das migrações anteriores. Ela habilita a configuração de frete grátis por distância e preço por quilômetro excedente, recalcula o frete e o total do pedido no banco e mantém a comissão do Software Pai incidente somente sobre o subtotal, sem comissão sobre frete. A migração `20261031000000_delivery_route_cache.sql` protege o cache de rotas para leitura/escrita apenas pelo servidor e cria a chave por loja e par de CEPs de origem/destino.

Implante a Edge Function (`supabase functions deploy quote-delivery`) após aplicar a migração `20261031000002_osm_routes_and_trial_storefronts.sql`. Em cache miss, a função geocodifica os CEPs de origem e destino no Nominatim (com `User-Agent: VancelySaaS-App/1.0`), calcula o trajeto no OSRM, grava distância e duração na tabela `delivery_routes_cache` e calcula o preço pelas regras existentes do lojista. O cache usa a loja e os CEPs normalizados de origem e destino. Lojas em status `trial` podem abrir a vitrine e testar o catálogo/cotação; o checkout de pedidos reais fica bloqueado até a ativação comercial.

A cotação de entrega acontece dentro do carrinho. O cliente pode escolher retirada quando habilitada pela loja ou entrega por motoboy; a tarifa e o frete grátis por distância são recalculados no banco ao criar o pedido.

## Conta do cliente, checkout e pagamentos

Aplique a migração `20261031000005_customer_commerce_and_asaas.sql` depois das migrações anteriores. O cliente pode navegar sem entrar, mas precisa criar conta, confirmar o e-mail e cadastrar CPF/CNPJ, telefone e endereço para concluir a compra. O checkout valida estoque e preços no banco, reserva estoque, cria o pedido e abre o checkout hospedado do Asaas para Pix ou cartão. O pedido só fica pago depois de um evento autenticado do webhook; não use os parâmetros de retorno do navegador como confirmação.

Configure estes segredos em **Supabase Dashboard → Edge Functions → Secrets**:

- `ASAAS_API_KEY`: chave de API da conta da plataforma Vancely. Use a chave de sandbox nos testes e a chave de produção somente no ambiente comercial.
- `ASAAS_ENVIRONMENT`: `sandbox` ou `production`, correspondente à chave acima.
- `ASAAS_WEBHOOK_TOKEN`: token aleatório forte, configurado também na autenticação do webhook Asaas (cabeçalho `asaas-access-token`).
- `APP_BASE_URL`: origem pública da aplicação, por exemplo `https://app.exemplo.com`, sem caminho de página.

Implante as funções:

```sh
supabase functions deploy create-asaas-checkout
supabase functions deploy asaas-checkout-webhook --no-verify-jwt
```

Mantenha a verificação JWT habilitada em `create-asaas-checkout`. O webhook usa o token próprio do Asaas e precisa ser implantado com `--no-verify-jwt`. No painel Asaas, cadastre a URL `https://<PROJECT_REF>.supabase.co/functions/v1/asaas-checkout-webhook`, configure o mesmo token e habilite `CHECKOUT_CREATED`, `CHECKOUT_PAID`, `CHECKOUT_CANCELED` e `CHECKOUT_EXPIRED`. Cada lojista deve informar o `walletId` Asaas de recebimento em `/app` → configuração de pagamentos; o valor fica protegido no banco e não é exposto na vitrine. A chave da API e o token de webhook nunca devem ser colocados no frontend.

Faça primeiro uma compra de teste completa em sandbox — incluindo entrega/retirada, Pix/cartão, evento de pagamento e cancelamento — antes de habilitar a chave de produção. A comissão é dividida no Checkout do Asaas e o webhook mantém o pedido e o estoque sincronizados. A linha interna de `transactions_split` continua sendo uma estimativa contábil baseada no subtotal bruto; concilie taxas do Asaas e valores líquidos com os relatórios do provedor antes de usar esses números para liquidação financeira.

A mesma migração adiciona saldo cumulativo de créditos avulsos de placas e créditos adicionais de NF-e vinculados ao ciclo atual da assinatura. `monthly_plate_limit` é a cota mensal configurável de placas do plano (inicia em zero para não inventar limites comerciais). A cota mensal do plano e o uso de NF-e são renovados pelo período da assinatura existente; os créditos adicionais de NF-e são zerados quando esse período muda. Consultas de placas consomem primeiro a cota mensal e depois o saldo adicional persistente. O RPC `grant_tenant_credits` só pode ser chamado com `service_role`, após confirmação de pagamento server-side, e usa referência de pagamento idempotente. O frontend mostra as cotas e saldos, mas não inicia compras PIX porque esta aplicação ainda não integra um gateway.

O painel `/app` oferece cadastro e edição de produtos para lojistas; vendedores (`staff`) podem cadastrar e editar, mas não excluir nem alterar configurações da loja. As regras equivalentes são aplicadas por RLS. O cadastro inclui marca, modelo, ano e motor compatíveis, custo/preço, estoque mínimo e endereço físico. O recebimento vincula a nota fiscal PDF/XML e registra quantidades previstas e conferidas; o estoque aumenta pela contagem física e fica um histórico fiscal. Arquivos fiscais são mantidos em bucket privado e disponibilizados somente aos membros autorizados da loja. Aplique `20261031000004_inventory_receipts_and_product_fitment.sql` depois das migrações anteriores. Fotos de produtos e logomarcas são reduzidas para no máximo 800 px de largura e convertidas para WebP antes do upload ao bucket `tenant-media`.

## Central Vancely e identidade white-label

A migração `20261028000000_master_analytics_branding.sql` reutiliza as tabelas existentes para fornecer o RPC de métricas da Central Vancely, índices para consultas por loja/período, compatibilidade RLS com os perfis `admin_master` e `vancely_admin`, e atualização validada da identidade visual da loja. Aplique-a após as migrações anteriores.

O painel calcula vendas pagas, entregas, fretes, splits por plano e consultas de placas a partir de `orders`, `transactions_split` e `plate_lookup_events`. A taxa de R$ 0,03 por consulta em cache é apresentada como estimativa de faturamento; o custo de API utiliza o campo `simulated_cost` que já existe. As cotas de placas agora são configuradas por `plans.monthly_plate_limit`. As renovações no gráfico são previsões baseadas em `current_period_end`, não pagamentos do gateway.

O fluxo de cadastro já cria loja, associação, assinatura e regra de entrega, e as rotas compartilhadas existentes atendem lojista/vendedor (`/app`), motoboy (`/entregador`) e cliente (`/loja/:slug`). A personalização do lojista salva nome, cor, frase e logomarca no bucket `tenant-media` já existente. Aplique também `20261031000001_promotional_storefront_banners.sql` após as migrações anteriores para persistir até cinco banners promocionais e exibi-los na vitrine pública. As imagens dos banners são reduzidas a no máximo 1600 px e convertidas para WebP antes do upload. Não há provisionamento de três instalações PWA independentes nem ícones white-label dinâmicos neste frontend.

A migração `20261031000003_trial_storefront_access.sql` deve ser aplicada depois das migrações anteriores: ela mantém vitrines `trial` acessíveis durante a demonstração, além das lojas `active`. Sem ela, uma definição anterior da RPC pública restringe a vitrine a lojas pagantes/ativas.

Esta base ainda não registra compras de blocos de estoque/NF-e adicionais, custos de chamadas de geocodificação/roteirização ou eventos de cobrança e renovação do gateway; o painel não inventa nem duplica essas receitas. A integração desses módulos exige conexão backend e persistência própria antes de exibir valores reais.

## Acesso do Admin Master às lojas

Aplique `20261029000000_master_tenant_access.sql` depois da migração de métricas. Ela amplia os helpers RLS já usados pelas políticas de tenant para que a role confiável `admin_master` possa ler e administrar tenants existentes e cria o RPC autenticado `get_master_tenant_by_slug` para abrir uma loja sem trocar a sessão do administrador.

Na Central Vancely, o seletor de lojas e as ações da lista abrem `/app/:slug`, `/driver/:slug` e `/loja/:slug`. As duas primeiras rotas exigem uma sessão com `app_metadata.role` autorizada; a prévia administrativa da loja permite gerenciar catálogo, frete e identidade visual, com as mesmas verificações RLS do Supabase. A vitrine é pública para lojas `active` e `trial` e mostra apenas produtos publicados. Nenhum acesso administrativo é concedido por `user_metadata` ou por e-mail informado pelo navegador: atribua `admin_master` exclusivamente por processo confiável no servidor/Supabase Auth.

## Integrações pendentes

As integrações Focus NFe e API externa de placas ainda dependem de configuração. O cadastro de recebimento fiscal é manual e registra os dados informados e o anexo XML/PDF; ele não importa automaticamente XML, valida a NF-e na SEFAZ nem substitui emissão/integração Focus NFe. A pesquisa por placa usa aplicações já cadastradas/cacheadas até a integração da API veicular.

## Verificação

```sh
npm run build
```
