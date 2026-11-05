# Distribuidora Campos — loja com login, entrega por km e Pix

Site estático (HTML/JS) + 4 funções serverless (pin, pix, webhook, create-user) na Vercel + Firebase (Auth e Firestore) + Pix pelo Mercado Pago (API de Orders).

**Como funciona:** a vitrine pública mostra tudo ESGOTADO. Segurando a lupa por ~1 s abre o login. Cliente entra direto na loja real. Admin e entregador passam por um PIN de 6 dígitos conferido no servidor.

## 0. Estrutura (tudo na pasta inicial, sem subpastas)
`index.html`, `app.js`, `style.css`, `firebase-config.js` = o site. `pin.js`, `pix.js`, `webhook.js`, `create-user.js`, `lib.js` = o servidor (Vercel). `vercel.json` liga `/api/pin` → `pin.js` etc.

**Importante:** o GitHub Pages só serve arquivos estáticos e NÃO roda as funções do servidor (Pix, PIN, webhook). Duas formas de publicar:
- **A (mais simples):** suba tudo no GitHub e importe o repositório na Vercel (vercel.com → Add New → Project → escolha o repo). O site e a API ficam no mesmo endereço. Não mexa em `API_BASE`.
- **B:** site no GitHub Pages + API na Vercel. Faça o passo A só para a API e, em `firebase-config.js`, coloque `API_BASE = "https://SEU-PROJETO.vercel.app"`. Em Settings → Pages, publique a branch `main` (pasta raiz). Opcional: variável `ALLOWED_ORIGIN` na Vercel = `https://SEUUSUARIO.github.io`.
Em ambos: Firebase → Authentication → Settings → Domínios autorizados → adicione o domínio do site.

## 1. Firebase
1. **Authentication** → ative *E-mail/senha*.
2. **Firestore** → crie o banco e cole o conteúdo de `firestore.rules` na aba Regras → Publicar.
3. Configurações do projeto → *Seus apps* → app Web → copie a config para `firebase-config.js`.
4. Configurações → *Contas de serviço* → *Gerar nova chave privada* (JSON). **Nunca** suba esse arquivo para o GitHub.

## 2. Vercel (Settings → Environment Variables)
| Nome | Valor |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | o conteúdo inteiro do JSON da chave |
| `MP_ACCESS_TOKEN` | Access Token de **teste** do Mercado Pago (depois, o de produção) |
| `MP_WEBHOOK_SECRET` | chave secreta do webhook (passo 3) |
| `MP_TEST` | `1` durante os testes (aprova o Pix sozinho). **Apague em produção.** |

Faça o deploy do projeto (a Vercel instala `firebase-admin` sozinha).

## 3. Webhook no Mercado Pago
Na sua aplicação → Webhooks → modo teste → URL `https://SEU-SITE.vercel.app/api/webhook`, evento **Orders**. Copie a chave secreta gerada para `MP_WEBHOOK_SECRET`.

## 4. Primeiro admin
1. Firebase → Authentication → crie o usuário (e-mail e senha) do dono.
2. No seu computador, com Node instalado: `npm install` e depois
   `FIREBASE_SERVICE_ACCOUNT="$(cat chave.json)" node definir-papel.js EMAIL admin 123456`
   (troque 123456 pelo PIN que quiser; 6 dígitos).
3. Entre pelo site (lupa → login → PIN). Em **Entrega**: toque em "Usar minha localização atual como loja", defina as faixas de km e a distância máxima. Em **Produtos**: cadastre os produtos. Em **Cadastros**: crie clientes e entregadores (entregador recebe um PIN próprio).

## 5. Testar o Pix
Entre como cliente, monte um pedido e pague. Com `MP_TEST=1` o Mercado Pago aprova sozinho e a tela do cliente muda para "Pagamento confirmado". O pedido então aparece como **pago** no admin e pode ser aberto pelo entregador pelo número.

## Segurança (já aplicada)
- Total, taxa e distância são recalculados no servidor; o navegador não define preço.
- O pedido só vira "pago" pelo webhook, com assinatura conferida e valor igual.
- PIN fica só no servidor (hash), com bloqueio de 15 min após 5 erros; vale por 8 h.
- Cadastro fechado: só quem você criar entra. Nenhuma chave secreta fica no código do site.

## Não testado / limites
- O código foi escrito mas **não foi executado contra o Firebase e o Mercado Pago reais**. Teste com credenciais de teste antes de vender.
- A assinatura do webhook segue o formato documentado; se o Mercado Pago recusar, veja Webhooks → Logs.
- Endereço é digitado pelo cliente (o GPS só dá as coordenadas); não há busca automática de endereço, avaliação de entregas nem cancelamento/estorno.
