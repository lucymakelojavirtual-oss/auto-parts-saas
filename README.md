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

## Central Vancely e identidade white-label

A migração `20261028000000_master_analytics_branding.sql` reutiliza as tabelas existentes para fornecer o RPC de métricas da Central Vancely, índices para consultas por loja/período, compatibilidade RLS com os perfis `admin_master` e `vancely_admin`, e atualização validada da identidade visual da loja. Aplique-a após as migrações anteriores.

O painel calcula vendas pagas, entregas, fretes, splits por plano e consultas de placas a partir de `orders`, `transactions_split` e `plate_lookup_events`. A taxa de R$ 0,03 por consulta em cache é apresentada como estimativa de faturamento; o custo de API utiliza o campo `simulated_cost` que já existe. Limites de consultas por plano não estão modelados. As renovações no gráfico são previsões baseadas em `current_period_end`, não pagamentos do gateway.

O fluxo de cadastro já cria loja, associação, assinatura e regra de entrega, e as rotas compartilhadas existentes atendem lojista/vendedor (`/app`), motoboy (`/entregador`) e cliente (`/loja/:slug`). A personalização do lojista salva nome, cor, frase e logomarca no bucket `tenant-media` já existente. Não há provisionamento de três instalações PWA independentes nem ícones white-label dinâmicos neste frontend.

Esta base ainda não registra compras de blocos de estoque/NF-e adicionais, custos do Google Maps ou eventos de cobrança e renovação do gateway; o painel não inventa nem duplica essas receitas. A integração desses módulos exige conexão backend e persistência própria antes de exibir valores reais.

## Integrações pendentes

As telas não fazem chamadas simuladas para emitir notas, consultar placas, cobrar micropagamentos, calcular rotas, criar pedidos ou processar pagamentos. As integrações Focus NFe, API de placas/cache e Google Maps precisam ser implementadas em funções seguras de backend antes de habilitar esses módulos. A vitrine e a área de entregas também aguardam as APIs de catálogo, pedidos, mapas e pagamentos.

## Verificação

```sh
npm run build
```
