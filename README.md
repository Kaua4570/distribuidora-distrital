# Distribuidora Campos — Cardápio Digital

Cardápio digital (`index.html`) + Painel do Dono (`admin.html`), com Firebase
como banco de dados/armazenamento de fotos.

## Arquivos
- `index.html` + `app.js` — cardápio que o cliente vê
- `admin.html` + `admin.js` — painel do dono (produtos, comandas, configurações, importação de backup)
- `style.css` — visual (tema dark + dourado), usado pelos dois
- `firebase-config.js` — já preenchido com as chaves do projeto `lanchonete-a98dc`
- `logo.png` — logo da Distribuidora Campos (coloque este arquivo na pasta)

## Passo 1 — Regras do Firestore
As chaves do Firebase já estão configuradas em `firebase-config.js`. Falta só liberar
as regras de acesso do banco, senão o site roda mas não consegue ler/gravar nada.

Este projeto **não usa Firebase Storage** — roda 100% no plano gratuito (Spark).
As fotos são salvas como texto Base64 (comprimidas via Canvas, máx. 400x400,
JPEG qualidade 0.75) direto no campo `imagemUrl` de cada produto no Firestore.
Só precisa mexer nas regras do **Firestore Database** mesmo.

No [Console do Firebase](https://console.firebase.google.com) → projeto `lanchonete-a98dc`
→ **Firestore Database → Regras**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /produtos/{id}     { allow read: if true; allow write: if true; }
    match /categorias/{id}   { allow read: if true; allow write: if true; }
    match /pedidos/{id}      { allow read: if true; allow create: if true; allow update, delete: if true; }
    match /config/{id}       { allow read: if true; allow write: if true; }
  }
}
```

⚠️ **Importante:** essas regras liberam escrita pra qualquer pessoa que
descobrir a URL do seu projeto — ótimo pra testar rápido, mas não é seguro
pra produção. O ideal, quando o site já estiver rodando bem, é:
- Ativar o **Firebase Authentication** (login por e-mail/senha) só pro admin.
- Trocar as regras de `produtos`, `categorias` e `config` para
  `allow write: if request.auth != null;` (só quem estiver logado escreve).
- `pedidos` pode manter `create: if true` (cliente sem login cria pedido),
  mas `update/delete` só para autenticado (o dono, no painel).

A senha simples em `firebase-config.js` (`ADMIN_SENHA`) é só uma trava de
tela — não impede alguém de escrever direto no banco se as regras estiverem
abertas. Reforce com Authentication assim que puder.

## Passo 2 — Importar backup (opcional)
1. Abra `admin.html` e entre com a senha (`ADMIN_SENHA` em `firebase-config.js`,
   valor padrão: `Campos@2026` — troque antes de publicar).
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
- Login do admin usa `sessionStorage` — some ao fechar a aba/navegador.
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
- Os produtos ficam na coleção **`produtos_secretos`**, separada de `produtos`
  (o catálogo público nunca lê essa coleção).
- Sair da conta (ou a sessão cair / a autorização ser removida) limpa a tela e volta ao início na hora.
- A sessão vale só para a aba (fechou a aba, saiu). Para manter logado, em `secreto-firebase.js`
  troque `browserSessionPersistence` por `browserLocalPersistence`.

## Arquivos
| Arquivo | Função |
|---|---|
| `acesso-secreto.js` | gesto de 5 s na logo + janela de login (carregado no `index.html`) |
| `secreto-firebase.js` | Firebase Auth (reaproveita o app de `firebase-config.js`) |
| `produtos-secretos.html / .js / .css` | área secreta (busca, categorias, detalhe) e estilos do login |
| `firestore.rules` | **regras completas e atualizadas** |
| `firestore.rules.test.mjs` | testes das regras (emulador oficial) |

Alterações em arquivos existentes (mínimas): `index.html` (+1 linha `<script>`) e
`firebase-config.js` (`app` passou a ser exportado). Nada mais foi tocado.

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
   - Campos: `ativo` (boolean) = `true`, e opcionais `email` (string) e `nome` (string)
3. Para **revogar**: mude `ativo` para `false` ou apague o documento — a tela do usuário é bloqueada na hora.

### 4. Adicionar produtos secretos

**Pelo app (recomendado):** torne o seu usuário administrador: no documento dele em `usuarios_autorizados`
adicione o campo `admin` (boolean) = `true`. Ao entrar na área secreta aparece o botão **+ Novo**; ao abrir um
produto aparece **Editar produto** (com **Excluir**). A foto é escolhida da galeria/câmera e comprimida automaticamente.
Usuários autorizados sem `admin` só visualizam.

**Pelo Console (alternativa):** Firestore → coleção `produtos_secretos` → **Add document** (ID automático). Campos:

| Campo | Tipo | Exemplo |
|---|---|---|
| `nome` | string | Whisky Reserva 1L |
| `categoria` | string | Destilados (as categorias aparecem sozinhas na navegação) |
| `preco` | number | 189.9 |
| `descricao` | string | Texto livre |
| `imagemUrl` | string | URL `https://...` ou imagem Base64 `data:image/jpeg;base64,...` |
| `disponivel` | boolean | true / false |
| `ordem` | number | 1 (opcional, ordena a lista) |
| `visivel` | boolean | false esconde o produto (opcional) |

Escrever em `produtos_secretos` só é permitido (nas regras) para `admin: true`, com validação de nome, categoria e preço.

### 5. Testar as regras
`firestore.rules.test.mjs` (instruções no topo do arquivo). Também dá para usar o
**Simulador de regras** do Console (aba Regras → Playground): leitura de `/produtos_secretos/x`
sem autenticação deve ser **negada**; autenticado com um UID que tem `usuarios_autorizados/{uid}.ativo == true`, **permitida**.

## ⚠️ Aviso sobre o painel atual
As regras antigas (mantidas) permitem **escrita pública** em `produtos`, `categorias`, `pedidos` e `config`,
e o `admin.html` usa só uma senha local (`ADMIN_SENHA`, visível no código). Isso **não afeta** a área secreta
(coleções novas, protegidas), mas vale migrar o painel para Firebase Authentication depois, como já sugerido acima.
