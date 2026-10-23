# Vancely Software

Portal inicial da plataforma SaaS Vancely com contextos separados para administração, lojistas, vitrine e entregadores. Login, cadastro, autorização por perfil e chamados usam Supabase; módulos que dependem de integrações operacionais permanecem desabilitados até a configuração das respectivas APIs.

## Rodar localmente

```sh
npm install
cp .env.example .env.local
npm run dev
```

Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` com os valores públicos do projeto Supabase. Nunca coloque uma chave `service_role` em variáveis `VITE_*` ou no navegador. `VITE_SUPPORT_WHATSAPP` deve conter apenas o número internacional, com DDI e DDD; `VITE_SUPPORT_EMAIL` é opcional.

## Supabase e autenticação

1. Aplique em sequência as migrações de `supabase/migrations/`.
2. Cadastre e ative no banco os planos **Essencial**, **Aceleração** e **Sede**, com preços e limites aprovados pela Vancely. O formulário de cadastro lista os planos ativos; não há preço comercial fixado nesta base.
3. Ative a confirmação de e-mail no Supabase Auth para produção e configure os URLs de redirecionamento do projeto para os domínios da aplicação.
4. Cadastre o perfil Master Admin como `vancely_admin` em `app_metadata` através de um processo administrativo confiável, usando a API Admin do Supabase apenas no servidor. Nunca permita que o navegador atribua esse perfil.
5. Configure e publique os textos finais de Termos de Licença, Garantia e Política de Cancelamento antes de aceitar cadastros de produção.

Rotas disponíveis:

- `/admin/login` e `/admin`: autenticação e área restrita da equipe Vancely.
- `/registrar`: onboarding da loja, plano, aceite e criação transacional de tenant, membership e assinatura.
- `/login` e `/app`: acesso da equipe da loja, com encaminhamento por perfil.
- `/loja/:slug`: ponto de entrada público da vitrine.
- `/entregador`: área protegida do entregador.

O cadastro é concluído pelo RPC `complete_tenant_registration`; se o Supabase exigir confirmação por e-mail, os dados de onboarding permanecem nos metadados da conta e a criação da loja é finalizada após o primeiro login confirmado. O RPC valida o plano ativo, o CNPJ e o aceite antes de gravar a loja.

O chat apresenta triagem inicial e, quando solicitado, persiste chamados e mensagens no Supabase com RLS e Supabase Realtime. Para operação real, configure também os contatos opcionais de suporte.

## Integrações pendentes

As telas não fazem chamadas simuladas para emitir notas, consultar placas, cobrar micropagamentos, calcular rotas, criar pedidos ou processar pagamentos. As integrações Focus NFe, API de placas/cache e Google Maps precisam ser implementadas em funções seguras de backend antes de habilitar esses módulos. A vitrine e a área de entregas também aguardam as APIs de catálogo, pedidos, mapas e pagamentos.

## Verificação

```sh
npm run build
```
