# Distribuidora Campos — Cardápio Digital

Cardápio digital (`index.html`) + Painel do Dono (`admin.html`), com Firebase
como banco de dados/armazenamento de fotos.

## Arquivos
- `index.html` + `app.js` — tela inicial (vitrine pública: produtos, busca e categorias; **sem carrinho**)
- `admin.html` + `admin.js` — painel do dono (produtos, comandas, configurações, importação de backup).
  **Só abre pela engrenagem ⚙️ da área secreta** (login Firebase + `admin: true`); alterna entre **Tela inicial** e **Tela secreta**
- `style.css` — visual (tema dark + dourado), usado pelos dois
- `firebase-config.js` — já preenchido com as chaves do projeto `lanchonete-a98dc`
- `logo.png` — logo da Distribuidora Campos (coloque este arquivo na pasta)

## Passo 1 — Regras do Firestore
Cole o conteúdo de `firestore.rules` em **Firestore Database → Regras → Publicar**.
O arquivo cobre tudo: tela inicial, tela secreta e painel. Resumo:
- `produtos`, `categorias`, `config`: **leitura pública**, gravação **só admin**.
- `pedidos`: só admin (a tela inicial não tem mais carrinho).
- `produtos_secretos`, `categorias_secretas`: leitura para usuários autorizados, gravação só admin.

Este projeto **não usa Firebase Storage** — roda 100% no plano gratuito (Spark).
As fotos são salvas como texto Base64 (comprimidas via Canvas, máx. 400x400,
JPEG qualidade 0.75) direto no campo `imagemUrl` de cada produto no Firestore.

⚠️ Publique as regras **junto** com os arquivos novos. O painel antigo (senha local) deixou de existir;
o novo só grava se o seu usuário tiver `admin: true` (veja "Área secreta → passo 3").

## Passo 2 — Importar backup (opcional)
1. Entre na área secreta (segure a logo por 5 s → login) e toque na engrenagem ⚙️.
   Escolha **Tela inicial** ou **Tela secreta** (a importação vai para a tela escolhida).
2. Vá na aba **Configurações → Importar backup do sistema antigo**.
3. Selecione o arquivo `.json` do seu backup e clique em **Importar arquivo**.
4. Aguarde a barra de progresso — cada produto é gravado como um documento
   no Firestore (a foto já vem em Base64 do backup antigo, sem upload a
   nenhum lugar), então é rápido mesmo com muitos produtos.

O que a importação faz:
- Cria as categorias do backup (sem duplicar as que já existem).
- Cria/atualiza cada produto (nome, categoria, preço, disponibilidade e foto em Base64).
- Preenche o WhatsApp da loja em Configurações, a partir do `telefoneLoja` do backup.
- Pode rodar de novo sem medo: produtos e categorias são identificados por
  código/nome, então uma nova importação **atualiza** em vez de duplicar.

Depois de importar, revise a aba **Produtos** — o campo "Volume/descrição"
vem em branco (o backup antigo não tinha esse campo separado do nome), então
edite os produtos que quiser deixar mais detalhados.

## Passo 3 — Publicar o site
Como é só HTML/CSS/JS, qualquer hospedagem estática serve. Mais simples:
- **Firebase Hosting** (fica tudo no mesmo projeto): `firebase init hosting`
  → `firebase deploy`.
- Ou: Netlify, Vercel, GitHub Pages — basta subir os arquivos da pasta
  (incluindo `logo.png`).

## Sobre as fotos (Base64, sem Storage)
- Ao cadastrar/editar um produto pelo painel, a foto escolhida é **comprimida
  no navegador** (redimensionada para no máximo 400x400px, JPEG qualidade
  0.75) antes de ser salva como texto Base64 no Firestore. Isso mantém o
  arquivo pequeno e evita qualquer custo de Storage.
- Fotos importadas do backup antigo (`p.image`) são gravadas como já vêm,
  sem recomprimir — na prática já costumam ser pequenas o suficiente.
- O Firestore tem um limite de 1 MB por documento. Uma foto bem comprimida
  fica bem abaixo disso, mas se algum produto específico não salvar, o
  motivo mais provável é uma imagem de origem muito grande — nesse caso,
  edite o produto e escolha a foto de novo pelo painel (ela passa pela
  compressão automática).

## Observações técnicas
- O carrinho fica só na memória da aba (não usa localStorage/sessionStorage
  para os itens do carrinho, por segurança e compatibilidade).
- O login (Firebase Authentication) vale só para a aba — fechou a aba, saiu.
- O som de novo pedido é gerado por código (Web Audio API), não depende de
  arquivo de áudio externo.
- Categorias, produtos, pedidos e status da loja são editáveis 100% pelo
  painel — nada fica "fixo" no código, exceto as chaves do Firebase.


---

# 🔒 Área secreta de produtos

Área reservada, separada do catálogo público, protegida por **Firebase Authentication**
e por **regras do Firestore** (a segurança real está no servidor, não no JavaScript).

## Como funciona
- Na página inicial, **segurar a logo por 5 segundos** abre uma janela de login. Soltou antes,
  saiu de cima da logo ou rolou a página → cancela. Não há dica, ícone, animação nem mudança visual.
- Login por **e-mail + senha** (Firebase Authentication). Não existe cadastro público.
- Depois do login, o app confere se o seu **UID** está em `usuarios_autorizados`. Se não estiver,
  a sessão é encerrada e aparece a mesma mensagem de senha incorreta (não revela nada).
- Os produtos ficam na coleção **`produtos_secretos`** (e as categorias em **`categorias_secretas`**), separadas de `produtos`/`categorias`
  (o catálogo público nunca lê essa coleção).
- Sair da conta (ou a sessão cair / a autorização ser removida) limpa a tela e volta ao início na hora.
- A sessão vale só para a aba (fechou a aba, saiu). Para manter logado, em `secreto-firebase.js`
  troque `browserSessionPersistence` por `browserLocalPersistence`.

## Arquivos
| Arquivo | Função |
|---|---|
| `acesso-secreto.js` | gesto de 5 s na logo + janela de login (carregado no `index.html`) |
| `secreto-firebase.js` | Firebase Auth (reaproveita o app de `firebase-config.js`) |
| `produtos-secretos.html / .js / .css` | área secreta (busca, categorias, detalhe, engrenagem ⚙️ para admins) e estilos do login |
| `firestore.rules` | **regras completas e atualizadas** |
| `firestore.rules.test.mjs` | testes das regras (emulador oficial) |



## Passo a passo

### 1. Publicar as regras
Console Firebase → projeto `lanchonete-a98dc` → **Firestore Database → Regras** →
cole o conteúdo de `firestore.rules` → **Publicar**.
As regras das coleções atuais (`produtos`, `categorias`, `pedidos`, `config`) foram mantidas
**idênticas** para não quebrar o site e o painel. Tudo que não está listado é negado.

### 2. Ativar login por e-mail/senha
Console → **Authentication → Vamos começar** (se for a primeira vez) → aba **Sign-in method**
→ **E-mail/senha** → ative **só a primeira opção** (E-mail/senha) → Salvar.
Deixe "Link por e-mail" desativado. Em **Authentication → Settings → User actions**,
desmarque *Enable create (sign-up)* se a opção aparecer — assim ninguém cria conta por conta própria.
Em **Settings → Authorized domains**, confira se o domínio onde o site está publicado consta na lista.

### 3. Cadastrar um usuário autorizado
1. **Authentication → Users → Add user**: informe e-mail e senha forte. Copie o **User UID**.
2. **Firestore Database → Iniciar coleção** (ou **+ Add document**) em `usuarios_autorizados`:
   - **ID do documento: o UID copiado** (exatamente)
   - Campos: `ativo` (boolean) = `true`, `admin` (boolean) = `true` (só para quem vai gerenciar produtos pela engrenagem) e opcionais `email` (string) e `nome` (string)
3. Para **revogar**: mude `ativo` para `false` ou apague o documento — a tela do usuário é bloqueada na hora.

### 4. Adicionar produtos (tela secreta e tela inicial) — pela engrenagem ⚙️
Com `admin: true` no seu documento de `usuarios_autorizados`, aparece uma **engrenagem ⚙️** no topo da área secreta
(no lugar do antigo "+ Novo"). Ao tocar nela abre o **painel**, que é a **mesma ferramenta** para as duas telas:

- No topo do painel há dois botões: **🏠 Tela inicial** e **🔒 Tela secreta**. O que você escolhe ali decide
  onde os produtos e as categorias são gravados (o painel sempre mostra "Editando agora: …").
- **Produtos:** cadastrar, editar, excluir, ocultar, marcar esgotado, reordenar arrastando (⠿).
- **Configurações → Categorias:** criar, remover e reordenar as "abas" de cada tela.
  Crie as categorias da tela secreta **antes** de cadastrar o primeiro produto dela.
- **Comandas** e **Configurações da loja** valem para o site todo (não mudam com o botão).
- O painel **não aparece na tela inicial** e não tem senha própria: sem login + `admin: true`, ele manda de volta ao início.

**Pelo Console (alternativa):** coleção `produtos_secretos` → campos `nome` (string), `categoriaId` (string = ID de um documento de
`categorias_secretas`), `preco` (number), `volume` (string), `descricao` (string), `imagemUrl` (string), `disponivel` (boolean),
`ordem` (number), `visivel` (boolean).

### 5. Testar as regras
`firestore.rules.test.mjs` (instruções no topo do arquivo). Também dá para usar o
**Simulador de regras** do Console (aba Regras → Playground): leitura de `/produtos_secretos/x`
sem autenticação deve ser **negada**; autenticado com um UID que tem `usuarios_autorizados/{uid}.ativo == true`, **permitida**.

## ✅ Sobre o painel e as regras
Com as regras novas, **ninguém consegue gravar** em `produtos`, `categorias`, `config` ou `pedidos` sem estar logado
como administrador — mesmo conhecendo a URL do projeto. A senha local (`ADMIN_SENHA`) foi removida.
Se, depois de publicar as regras, o painel mostrar "Sem permissão", confira: (1) as regras foram publicadas,
(2) o seu documento em `usuarios_autorizados` tem `ativo: true` e `admin: true`.
