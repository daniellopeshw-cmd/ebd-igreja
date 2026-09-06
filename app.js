/* ==========================================================================
   SISTEMA EBD — LÓGICA PRINCIPAL
   Este arquivo depende de:
   - config.js  (definindo window.FIREBASE_CONFIG)
   - Firebase SDK compat (carregado no index.html)
   ========================================================================== */

firebase.initializeApp(window.FIREBASE_CONFIG);
const auth = firebase.auth();
const db = firebase.firestore();

// App secundário: usado só para criar novos usuários sem derrubar a sessão do admin logado
const appSecundario = firebase.initializeApp(window.FIREBASE_CONFIG, "Secundario");
const authSecundario = appSecundario.auth();

let usuarioAtual = null;   // { uid, nome, telefone, papel, turmaId }
let turmaSelecionada = null;
let turmasCache = [];

/* ---------------------------------------------------------------------- */
/* Utilitários                                                             */
/* ---------------------------------------------------------------------- */

function apenasDigitos(texto) {
  return (texto || "").replace(/\D/g, "");
}

// Firebase Auth exige um "e-mail". Convertemos o celular num e-mail interno,
// assim o usuário só precisa saber o próprio número + senha.
function telefoneParaEmailInterno(telefone) {
  const digitos = apenasDigitos(telefone);
  return `tel${digitos}@ebd.igreja.app`;
}

function mostrarErroLogin(msg) {
  const el = document.getElementById("login-erro");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("login-ok").style.display = "none";
}

function mostrarOkLogin(msg) {
  const el = document.getElementById("login-ok");
  el.textContent = msg;
  el.style.display = "block";
  document.getElementById("login-erro").style.display = "none";
}

function limparMensagensLogin() {
  document.getElementById("login-erro").style.display = "none";
  document.getElementById("login-ok").style.display = "none";
}

function mostrarRecuperar() {
  document.getElementById("bloco-login-senha").style.display = "none";
  document.getElementById("bloco-recuperar").style.display = "block";
  limparMensagensLogin();
}

function mostrarLogin() {
  document.getElementById("bloco-login-senha").style.display = "block";
  document.getElementById("bloco-recuperar").style.display = "none";
  limparMensagensLogin();
}

function fecharModal(id) {
  document.getElementById(id).style.display = "none";
}

function abrirModal(id) {
  document.getElementById(id).style.display = "flex";
}

/* ---------------------------------------------------------------------- */
/* Login / Logout                                                          */
/* ---------------------------------------------------------------------- */

async function fazerLogin() {
  limparMensagensLogin();
  const telefone = document.getElementById("login-telefone").value;
  const senha = document.getElementById("login-senha").value;

  if (!apenasDigitos(telefone) || !senha) {
    mostrarErroLogin("Informe o celular e a senha.");
    return;
  }

  const email = telefoneParaEmailInterno(telefone);
  try {
    await auth.signInWithEmailAndPassword(email, senha);
    // onAuthStateChanged cuida do resto (carregar dados e mostrar o app)
  } catch (erro) {
    console.error(erro);
    if (erro.code === "auth/invalid-credential" || erro.code === "auth/wrong-password" || erro.code === "auth/user-not-found") {
      mostrarErroLogin("Celular ou senha incorretos.");
    } else {
      mostrarErroLogin("Não foi possível entrar. Tente novamente.");
    }
  }
}

function sair() {
  auth.signOut();
}

auth.onAuthStateChanged(async (user) => {
  if (!user) {
    usuarioAtual = null;
    document.getElementById("tela-login").style.display = "flex";
    document.getElementById("app").style.display = "none";
    return;
  }

  try {
    const doc = await db.collection("usuarios").doc(user.uid).get();
    if (!doc.exists) {
      mostrarErroLogin("Seu acesso ainda não foi liberado. Fale com um coordenador.");
      await auth.signOut();
      return;
    }
    const dados = doc.data();
    usuarioAtual = {
      uid: user.uid,
      nome: dados.nome,
      telefone: dados.telefone,
      papel: dados.papel,       // 'professor' | 'coordenador' | 'pastor'
      turmaId: dados.turmaId || null,
    };
    document.getElementById("tela-login").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("nome-usuario-topo").textContent =
      `${usuarioAtual.nome} · ${rotuloPapel(usuarioAtual.papel)}`;
    montarAbas();
    irParaAba("turmas");
  } catch (erro) {
    console.error(erro);
    mostrarErroLogin("Erro ao carregar seu perfil. Tente novamente.");
  }
});

function rotuloPapel(papel) {
  return { professor: "Professor(a)", coordenador: "Coordenador(a)", pastor: "Pastor(a)" }[papel] || papel;
}

function ehGestor() {
  return usuarioAtual && (usuarioAtual.papel === "coordenador" || usuarioAtual.papel === "pastor");
}

/* ---------------------------------------------------------------------- */
/* Navegação por abas                                                       */
/* ---------------------------------------------------------------------- */

function montarAbas() {
  const abas = [{ id: "turmas", rotulo: "Turmas" }];
  if (ehGestor()) abas.push({ id: "usuarios", rotulo: "Acessos" });

  const container = document.getElementById("abas");
  container.innerHTML = "";
  abas.forEach((a) => {
    const el = document.createElement("div");
    el.className = "aba";
    el.textContent = a.rotulo;
    el.onclick = () => irParaAba(a.id);
    el.dataset.aba = a.id;
    container.appendChild(el);
  });
}

function irParaAba(id) {
  document.querySelectorAll(".aba").forEach((el) => {
    el.classList.toggle("ativa", el.dataset.aba === id);
  });
  document.querySelectorAll("main > .secao").forEach((el) => el.classList.remove("ativa"));

  if (id === "turmas") {
    document.getElementById("secao-turmas").classList.add("ativa");
    document.getElementById("desc-turmas").textContent = ehGestor()
      ? "Todas as turmas da escola bíblica."
      : "Sua turma.";
    document.getElementById("barra-nova-turma").style.display = ehGestor() ? "flex" : "none";
    carregarTurmas();
  } else if (id === "usuarios") {
    document.getElementById("secao-usuarios").classList.add("ativa");
    carregarUsuarios();
  }
}

/* ---------------------------------------------------------------------- */
/* TURMAS                                                                   */
/* ---------------------------------------------------------------------- */

async function carregarTurmas() {
  const lista = document.getElementById("lista-turmas");
  lista.innerHTML = '<div class="carregando">Carregando...</div>';

  try {
    let query = db.collection("turmas");
    if (!ehGestor()) {
      query = query.where(firebase.firestore.FieldPath.documentId(), "==", usuarioAtual.turmaId || "___nenhuma___");
    }
    const snap = await query.get();
    turmasCache = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    if (turmasCache.length === 0) {
      lista.innerHTML = '<div class="vazio">Nenhuma turma cadastrada ainda.</div>';
      return;
    }

    lista.innerHTML = "";
    turmasCache.forEach((t) => {
      const el = document.createElement("div");
      el.className = "lista-item";
      el.innerHTML = `
        <div class="info">
          <b>${escapeHtml(t.nome)}</b>
          <span>${escapeHtml(t.professorNome || "Sem professor definido")}</span>
        </div>
        <div class="acoes">
          <button onclick="abrirAlunos('${t.id}')">Alunos</button>
          <button onclick="abrirChamada('${t.id}')">Chamada</button>
          ${ehGestor() ? `<button class="excluir" onclick="excluirTurma('${t.id}')">Excluir</button>` : ""}
        </div>`;
      lista.appendChild(el);
    });
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = '<div class="vazio">Não foi possível carregar as turmas.</div>';
  }
}

async function abrirModalTurma() {
  const select = document.getElementById("turma-professor");
  select.innerHTML = '<option value="">Selecione...</option>';
  const snap = await db.collection("usuarios").where("papel", "==", "professor").get();
  snap.docs.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nome;
    select.appendChild(opt);
  });
  document.getElementById("turma-nome").value = "";
  abrirModal("modal-turma");
}

async function salvarTurma() {
  const nome = document.getElementById("turma-nome").value.trim();
  const professorId = document.getElementById("turma-professor").value;
  if (!nome) { alert("Informe o nome da turma."); return; }

  let professorNome = "";
  if (professorId) {
    const docProf = await db.collection("usuarios").doc(professorId).get();
    professorNome = docProf.exists ? docProf.data().nome : "";
  }

  const novaTurmaRef = await db.collection("turmas").add({
    nome,
    professorId: professorId || null,
    professorNome: professorNome || null,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });

  if (professorId) {
    await db.collection("usuarios").doc(professorId).update({ turmaId: novaTurmaRef.id });
  }

  fecharModal("modal-turma");
  carregarTurmas();
}

async function excluirTurma(turmaId) {
  if (!confirm("Excluir esta turma? Os alunos e presenças cadastrados nela também serão perdidos.")) return;
  await db.collection("turmas").doc(turmaId).delete();
  carregarTurmas();
}

/* ---------------------------------------------------------------------- */
/* ALUNOS                                                                   */
/* ---------------------------------------------------------------------- */

function abrirAlunos(turmaId) {
  turmaSelecionada = turmasCache.find((t) => t.id === turmaId);
  document.querySelectorAll("main > .secao").forEach((el) => el.classList.remove("ativa"));
  document.getElementById("secao-alunos").classList.add("ativa");
  document.getElementById("titulo-turma-alunos").textContent = turmaSelecionada.nome;
  carregarAlunos();
}

function voltarParaTurmas() {
  irParaAba("turmas");
}

async function carregarAlunos() {
  const lista = document.getElementById("lista-alunos");
  lista.innerHTML = '<div class="carregando">Carregando...</div>';

  const snap = await db.collection("alunos").where("turmaId", "==", turmaSelecionada.id).orderBy("nome").get();
  if (snap.empty) {
    lista.innerHTML = '<div class="vazio">Nenhum aluno cadastrado nesta turma.</div>';
    return;
  }
  lista.innerHTML = "";
  snap.docs.forEach((d) => {
    const a = d.data();
    const el = document.createElement("div");
    el.className = "lista-item";
    el.innerHTML = `
      <div class="info">
        <b>${escapeHtml(a.nome)}</b>
        ${a.contato ? `<span>${escapeHtml(a.contato)}</span>` : ""}
      </div>
      <div class="acoes">
        <button class="excluir" onclick="excluirAluno('${d.id}')">Remover</button>
      </div>`;
    lista.appendChild(el);
  });
}

function abrirModalAluno() {
  document.getElementById("aluno-nome").value = "";
  document.getElementById("aluno-contato").value = "";
  abrirModal("modal-aluno");
}

async function salvarAluno() {
  const nome = document.getElementById("aluno-nome").value.trim();
  const contato = document.getElementById("aluno-contato").value.trim();
  if (!nome) { alert("Informe o nome do aluno."); return; }

  await db.collection("alunos").add({
    nome,
    contato: contato || null,
    turmaId: turmaSelecionada.id,
    criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });

  fecharModal("modal-aluno");
  carregarAlunos();
}

async function excluirAluno(alunoId) {
  if (!confirm("Remover este aluno da turma?")) return;
  await db.collection("alunos").doc(alunoId).delete();
  carregarAlunos();
}

/* ---------------------------------------------------------------------- */
/* CHAMADA / PRESENÇA                                                       */
/* ---------------------------------------------------------------------- */

function abrirChamada(turmaId) {
  turmaSelecionada = turmasCache.find((t) => t.id === turmaId);
  document.querySelectorAll("main > .secao").forEach((el) => el.classList.remove("ativa"));
  document.getElementById("secao-chamada").classList.add("ativa");
  document.getElementById("titulo-turma-chamada").textContent = "Chamada · " + turmaSelecionada.nome;

  const hoje = new Date().toISOString().slice(0, 10);
  document.getElementById("data-chamada").value = hoje;
  carregarChamada();
}

async function carregarChamada() {
  const lista = document.getElementById("lista-chamada");
  lista.innerHTML = '<div class="carregando">Carregando...</div>';

  const data = document.getElementById("data-chamada").value;
  const [alunosSnap, presencaSnap] = await Promise.all([
    db.collection("alunos").where("turmaId", "==", turmaSelecionada.id).orderBy("nome").get(),
    db.collection("presencas").doc(`${turmaSelecionada.id}_${data}`).get(),
  ]);

  if (alunosSnap.empty) {
    lista.innerHTML = '<div class="vazio">Cadastre alunos nesta turma antes de fazer a chamada.</div>';
    return;
  }

  const presencaSalva = presencaSnap.exists ? presencaSnap.data().presenca || {} : {};

  lista.innerHTML = "";
  alunosSnap.docs.forEach((d) => {
    const a = d.data();
    const estado = presencaSalva[d.id]; // true, false ou undefined
    const el = document.createElement("div");
    el.className = "lista-item";
    el.innerHTML = `
      <div class="info"><b>${escapeHtml(a.nome)}</b></div>
      <div class="toggle-presenca" data-aluno="${d.id}">
        <button type="button" class="sel-presente ${estado === true ? "on" : ""}" onclick="marcarPresenca('${d.id}', true)">Presente</button>
        <button type="button" class="sel-ausente ${estado === false ? "on" : ""}" onclick="marcarPresenca('${d.id}', false)">Ausente</button>
      </div>`;
    lista.appendChild(el);
  });
}

const presencaEmEdicao = {};

function marcarPresenca(alunoId, presente) {
  presencaEmEdicao[alunoId] = presente;
  const grupo = document.querySelector(`.toggle-presenca[data-aluno="${alunoId}"]`);
  grupo.querySelector(".sel-presente").classList.toggle("on", presente === true);
  grupo.querySelector(".sel-ausente").classList.toggle("on", presente === false);
}

async function salvarChamada() {
  const data = document.getElementById("data-chamada").value;
  if (!data) { alert("Selecione a data da aula."); return; }

  const docRef = db.collection("presencas").doc(`${turmaSelecionada.id}_${data}`);
  const atual = await docRef.get();
  const presencaFinal = { ...(atual.exists ? atual.data().presenca : {}), ...presencaEmEdicao };

  await docRef.set({
    turmaId: turmaSelecionada.id,
    data,
    presenca: presencaFinal,
    registradoPor: usuarioAtual.uid,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });

  Object.keys(presencaEmEdicao).forEach((k) => delete presencaEmEdicao[k]);
  alert("Presença salva!");
}

/* ---------------------------------------------------------------------- */
/* USUÁRIOS / ACESSOS (somente coordenador e pastor)                        */
/* ---------------------------------------------------------------------- */

async function carregarUsuarios() {
  const lista = document.getElementById("lista-usuarios");
  lista.innerHTML = '<div class="carregando">Carregando...</div>';

  const snap = await db.collection("usuarios").orderBy("nome").get();
  lista.innerHTML = "";
  snap.docs.forEach((d) => {
    const u = d.data();
    const el = document.createElement("div");
    el.className = "lista-item";
    el.innerHTML = `
      <div class="info">
        <b>${escapeHtml(u.nome)}</b>
        <span>${escapeHtml(u.telefone)} · <span class="selo">${rotuloPapel(u.papel)}</span></span>
      </div>
      <div class="acoes">
        ${d.id !== usuarioAtual.uid ? `<button class="excluir" onclick="excluirUsuario('${d.id}')">Remover acesso</button>` : ""}
      </div>`;
    lista.appendChild(el);
  });
}

async function abrirModalUsuario() {
  document.getElementById("usuario-nome").value = "";
  document.getElementById("usuario-telefone").value = "";
  document.getElementById("usuario-senha").value = "";
  document.getElementById("usuario-papel").value = "professor";

  const select = document.getElementById("usuario-turma");
  select.innerHTML = '<option value="">Nenhuma (definir depois)</option>';
  const snap = await db.collection("turmas").get();
  snap.docs.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nome;
    select.appendChild(opt);
  });

  atualizarCampoTurmaUsuario();
  abrirModal("modal-usuario");
}

function atualizarCampoTurmaUsuario() {
  const papel = document.getElementById("usuario-papel").value;
  document.getElementById("campo-turma-usuario").style.display = papel === "professor" ? "block" : "none";
}

async function salvarUsuario() {
  const nome = document.getElementById("usuario-nome").value.trim();
  const telefone = document.getElementById("usuario-telefone").value.trim();
  const senha = document.getElementById("usuario-senha").value;
  const papel = document.getElementById("usuario-papel").value;
  const turmaId = document.getElementById("usuario-turma").value || null;

  if (!nome || !apenasDigitos(telefone) || !senha) {
    alert("Preencha nome, celular e senha.");
    return;
  }
  if (senha.length < 6) {
    alert("A senha precisa ter pelo menos 6 caracteres.");
    return;
  }

  const email = telefoneParaEmailInterno(telefone);

  try {
    // Usa o app secundário para não deslogar o coordenador/pastor atual
    const credencial = await authSecundario.createUserWithEmailAndPassword(email, senha);
    const novoUid = credencial.user.uid;
    await authSecundario.signOut();

    await db.collection("usuarios").doc(novoUid).set({
      nome,
      telefone: apenasDigitos(telefone),
      papel,
      turmaId: papel === "professor" ? turmaId : null,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: usuarioAtual.uid,
    });

    if (papel === "professor" && turmaId) {
      await db.collection("turmas").doc(turmaId).update({ professorId: novoUid, professorNome: nome });
    }

    fecharModal("modal-usuario");
    carregarUsuarios();
  } catch (erro) {
    console.error(erro);
    if (erro.code === "auth/email-already-in-use") {
      alert("Já existe um acesso cadastrado com este número de celular.");
    } else {
      alert("Não foi possível criar o acesso. Tente novamente.");
    }
  }
}

async function excluirUsuario(uid) {
  if (!confirm("Remover o acesso desta pessoa ao sistema?")) return;
  // Observação: isto remove o cadastro no Firestore. Para remover também o login
  // do Firebase Authentication, é preciso usar o painel do Firebase Console
  // (Authentication > Users) ou uma Cloud Function — não é possível pelo app cliente.
  await db.collection("usuarios").doc(uid).delete();
  carregarUsuarios();
  alert("Acesso removido do sistema. Se quiser bloquear o login por completo, remova também o usuário em Firebase Console > Authentication.");
}

/* ---------------------------------------------------------------------- */
/* Auxiliar                                                                 */
/* ---------------------------------------------------------------------- */

function escapeHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
