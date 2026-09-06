# Sistema de Controle da EBD

Sistema simples e **100% gratuito** para controle da Escola Bíblica Dominical:
turmas, alunos e chamada de presença, com login individual por celular + senha
e permissões por papel:

- **Professor(a):** só vê e edita a própria turma (alunos e chamada).
- **Coordenador(a) / Pastor(a):** veem e editam todas as turmas, e cadastram
  novos acessos ao sistema.

Funciona no celular (navegador) como se fosse um app — dá para "Adicionar à
tela inicial" e abre em tela cheia, sem instalar nada de loja de aplicativo.

---

## Como funciona por baixo dos panos

- O **visual** (HTML/CSS/JS) fica hospedado gratuitamente no **GitHub Pages**.
- O **login e o banco de dados** ficam no **Firebase** (Google), no plano
  gratuito "Spark" — dá conta tranquilamente do tamanho de uma igreja.
- Quem garante que um professor não veja a turma dos outros são as
  **Regras do Firestore** (arquivo `firestore.rules`), que rodam no servidor
  do Google — ou seja, mesmo que alguém tente "burlar" pelo navegador, o
  servidor bloqueia.

Nenhuma etapa abaixo tem custo, desde que sua igreja use quantidades normais
(algumas dezenas de turmas/alunos, uso diário moderado).

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse **console.firebase.google.com** e entre com uma conta Google.
2. Clique em **Adicionar projeto**, dê um nome (ex: `ebd-igreja`) e conclua a criação.
3. No menu lateral, vá em **Compilação > Authentication** → **Vamos começar**.
   - Na aba **Sign-in method**, ative o provedor **E-mail/senha**.
   - *(Não precisa ativar "Telefone" — usamos e-mail/senha por baixo dos panos
     para o login funcionar de graça, mesmo digitando o celular na tela.)*
4. No menu lateral, vá em **Compilação > Firestore Database** → **Criar banco de dados**.
   - Escolha o modo **produção** e a localização mais próxima (ex: `southamerica-east1`).
5. Ainda no Firestore, vá na aba **Regras**, apague o conteúdo padrão, cole
   todo o conteúdo do arquivo **`firestore.rules`** (que veio junto com este
   pacote) e clique em **Publicar**.
6. Volte em **Configurações do projeto** (ícone de engrenagem, topo do menu)
   → aba **Geral** → role até "Seus aplicativos" → clique no ícone **Web `</>`**.
   - Dê um apelido (ex: `sistema-ebd`) e clique em **Registrar app**.
   - Copie o objeto `firebaseConfig` que aparece na tela.

## Passo 2 — Preencher o `config.js`

Abra o arquivo `config.js` (que veio neste pacote) e substitua os valores de
exemplo pelos que você copiou do Firebase no passo anterior. Salve o arquivo.

## Passo 3 — Publicar no GitHub Pages

1. Crie uma conta gratuita em **github.com**, se ainda não tiver.
2. Crie um **novo repositório** (pode ser privado ou público), ex: `ebd-igreja`.
3. Envie os arquivos deste pacote para o repositório: `index.html`, `app.js`,
   `config.js` (já editado), `firestore.rules` (fica só de referência) e
   `manifest.json`.
   - Pode ser pelo site do GitHub ("Add file > Upload files") ou por linha de
     comando, o que for mais fácil para você.
4. No repositório, vá em **Settings > Pages**.
   - Em "Source", selecione a branch `main` e a pasta `/ (root)`.
   - Salve. Em alguns minutos o GitHub mostrará o endereço do seu site, algo
     como `https://seu-usuario.github.io/ebd-igreja/`.

Pronto — esse link é o que você vai compartilhar com coordenadores, pastores
e professores.

## Passo 4 — Cadastrar o primeiro coordenador (você mesmo)

Como o próprio app só permite criar novos acessos por quem já é coordenador
ou pastor, o **primeiro usuário** precisa ser criado direto pelo Firebase:

1. No Firebase Console, vá em **Authentication > Users > Add user**.
   - E-mail: `tel` + seu número de celular só com dígitos + `@ebd.igreja.app`
     (exemplo: celular `11912345678` → e-mail `tel11912345678@ebd.igreja.app`).
   - Senha: escolha uma senha temporária.
   - Copie o **UID** gerado para esse usuário.
2. Vá em **Firestore Database > Dados** → crie uma coleção chamada `usuarios`.
   - Crie um documento cujo **ID do documento** seja exatamente o UID copiado.
   - Adicione os campos:
     - `nome` (string) → seu nome
     - `telefone` (string) → seu celular, só dígitos (ex: `11912345678`)
     - `papel` (string) → `coordenador`
3. Pronto! Agora entre no site publicado, digite seu celular e a senha que
   você definiu, e use a aba **Acessos** dentro do app para cadastrar os
   demais coordenadores, pastores e professores normalmente — sem precisar
   mexer no Firebase Console de novo.

---

## O que o sistema já faz

- Login por celular + senha, com sessão mantida no navegador.
- Cadastro de turmas (coordenador/pastor), com professor responsável.
- Cadastro de alunos por turma, com data de nascimento e selo de aniversário na chamada.
- Chamada de presença por data, com revistas, bíblias, visitantes e oferta.
- Editar ou excluir uma chamada já registrada.
- Relatório do fechamento do domingo, com turmas campeãs por categoria e exportação em PDF (botão "Imprimir", escolha "Salvar como PDF" na janela de impressão).
- Histórico mensal com gráficos de presença e oferta, filtrável por turma.
- Sistema de trimestres: ao trocar a lição (a cada ~3 meses), o coordenador inicia um novo trimestre e escolhe se repete os alunos matriculados ou começa turmas vazias.
- Um coordenador/pastor também pode ser cadastrado como professor de uma turma, sem perder o acesso total.
- Cada professor só enxerga a própria turma; coordenador e pastor veem tudo. Relatórios (Relatório e Histórico) são visíveis apenas para coordenador/pastor.

## Sobre a logo da igreja

Para exibir a logo no topo do sistema e na tela de login:
1. Salve a imagem da logo com o nome exato **`logo.png`** (formato PNG, de preferência com fundo transparente).
2. Envie esse arquivo para o mesmo repositório no GitHub, junto dos outros arquivos (`index.html`, `app.js` etc.), na raiz do projeto.
3. Pronto — o sistema já está preparado para exibi-la automaticamente. Se o arquivo não existir, o sistema simplesmente não mostra nada no lugar (sem quebrar a tela).

## Sobre os trimestres

- Ao entrar na aba **Turmas**, coordenador/pastor veem um aviso no topo com o trimestre atual.
- O botão **"Iniciar novo trimestre"** cria um novo período (ex: "2º Trimestre 2027") e pergunta se os alunos matriculados devem continuar nas mesmas turmas ou se cada turma deve começar vazia (para nova matrícula geral).
- Alunos cadastrados ficam sempre vinculados ao trimestre em que foram matriculados — isso mantém o histórico de frequência de trimestres antigos intacto mesmo depois de trocar de período.

## Depois de atualizar os arquivos

Sempre que eu te enviar `index.html`, `app.js` ou `firestore.rules` atualizados, lembre de:
1. Subir os arquivos `.html`/`.js` no GitHub (substituindo os antigos).
2. Se o `firestore.rules` também mudou, copiar o novo conteúdo para Firebase Console > Firestore Database > Regras > Publicar.

## Dúvidas comuns

**"Aparece uma tela de recuperação de senha, mas isso não está implementado
de verdade."** — Isso mesmo: o botão "Esqueci minha senha" hoje só mostra uma
mensagem, porque o login é por celular (não por e-mail real). Enquanto isso,
peça a um coordenador para recadastrar sua senha em **Authentication > Users**
no Firebase Console (clique nos três pontinhos ao lado do usuário >
"Redefinir senha").

**"Posso usar isso com muitas turmas e alunos, sem pagar nada?"** — Sim, o
plano gratuito do Firebase (Spark) permite até 50 mil leituras e 20 mil
gravações por dia — muito acima do uso normal de uma igreja.
