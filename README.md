# Vancely Software

Base demonstrativa de uma plataforma SaaS whitelabel para autopeças. O app funciona sem serviços externos; a integração Supabase é opcional e preparada para autenticação, catálogo, cache de veículos, garagem e Storage.

## Rodar localmente

```sh
npm install
npm run dev
```

Abra `http://localhost:5173`. Use a navegação lateral para alternar entre o sistema Vancely, painel do lojista, vitrine B2C e app do motoboy. O carrinho, consulta de placa, frete, split, banners e corrida são interativos.

O modo local persiste cache de placas e garagem em `localStorage`. A primeira consulta de uma placa válida leva 1 segundo e simula R$ 0,07; consultas seguintes custam R$ 0,00. As placas e dados gerados são fictícios.

## Supabase

1. Crie um projeto Supabase e aplique `supabase/migrations/20261023000000_initial_schema.sql` pelo Supabase CLI ou SQL Editor.
2. Copie `.env.example` para `.env.local` e preencha `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` e `VITE_DEMO_TENANT_ID`.
3. Crie o lojista e os usuários no Supabase Auth e associe a equipe em `tenant_members`. O usuário autenticado precisa pertencer ao tenant para escrever no Storage.

A consulta autenticada lê `vehicle_cache` via RPC antes de chamar o mock com atraso; a função SQL grava de forma idempotente e registra custo apenas para um cache miss efetivo. `get_cached_vehicle` não retorna chassi ou Renavam. A garagem usa a identidade autenticada. Upload de mídia converte para WebP, limita o maior lado a 1400 px e envia ao bucket `tenant-media` (leitura pública, escrita restrita por tenant). Sem sessão/configuração, continua no modo local.

O Supabase Auth é usado pelo adaptador, mas esta base não inclui uma tela de login. Para testar a integração, autentique o usuário via Supabase Auth e associe-o ao tenant antes de usar o app.

## Estrutura

```text
src/
	App.tsx                 Workspaces e fluxos demonstrativos
	services/mock.ts        Cache local, veículos, catálogo, frete, split e WebP
	services/supabase.ts    Adaptador opcional Supabase Auth, RPC e Storage
	styles.css              Sistema visual responsivo
supabase/
	migrations/             Esquema PostgreSQL, RLS e bucket de mídia
public/
	manifest.webmanifest    Metadados de instalação PWA
	sw.js                   Shell offline básico
```

## Limites desta demonstração

- Consulta externa, preço de custo, PIX/cartão/boleto, repasse financeiro, distância, rota e geolocalização são simulações. Não há cobrança, gateway, geocodificação ou integração de mapas.
- A consulta de placa é gerada no navegador. Em produção, mova a chamada externa e a gravação/cobrança para uma Edge Function confiável; não aceite dados de veículo ou custo definidos pelo cliente.
- O adaptador de Auth depende de uma sessão já criada e a escrita no Storage exige um tenant válido e membership correspondente. A criação de pedidos e split deve ocorrer em uma Edge Function/RPC transacional com validação de preço e estoque no servidor.
- O service worker mantém o shell básico; catálogo e mídia continuam dependendo de rede.

## Verificação

```sh
npm run build
```
