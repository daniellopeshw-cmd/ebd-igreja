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
let trimestreAtivo = null; // { id, nome, dataInicio, dataFim }
let graficosHistorico = []; // instâncias do Chart.js ativas, para destruir ao trocar de filtro

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
  if (ehGestor()) {
    abas.push({ id: "relatorio", rotulo: "Relatório" });
    abas.push({ id: "historico", rotulo: "Histórico" });
    abas.push({ id: "usuarios", rotulo: "Acessos" });
  }

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
    document.getElementById("banner-trimestre").style.display = ehGestor() ? "flex" : "none";
    carregarTrimestreAtivo().then(carregarTurmas);
  } else if (id === "usuarios") {
    document.getElementById("secao-usuarios").classList.add("ativa");
    carregarUsuarios();
  } else if (id === "relatorio") {
    document.getElementById("secao-relatorio").classList.add("ativa");
    const campoData = document.getElementById("data-relatorio");
    if (!campoData.value) campoData.value = new Date().toISOString().slice(0, 10);
    carregarRelatorio();
  } else if (id === "historico") {
    document.getElementById("secao-historico").classList.add("ativa");
    const campoMes = document.getElementById("historico-mes");
    if (!campoMes.value) campoMes.value = new Date().toISOString().slice(0, 7);
    carregarFiltroTurmasHistorico();
    carregarHistorico();
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
/* TRIMESTRES (a cada ~3 meses a lição muda)                                */
/* ---------------------------------------------------------------------- */

async function carregarTrimestreAtivo() {
  try {
    const snap = await db.collection("trimestres").orderBy("criadoEm", "desc").limit(1).get();
    if (snap.empty) {
      trimestreAtivo = null;
      document.getElementById("nome-trimestre-atual").textContent = "Nenhum trimestre iniciado ainda";
      return;
    }
    const doc = snap.docs[0];
    trimestreAtivo = { id: doc.id, ...doc.data() };
    const periodo = trimestreAtivo.dataInicio && trimestreAtivo.dataFim
      ? ` (${formatarDataBR(trimestreAtivo.dataInicio)} a ${formatarDataBR(trimestreAtivo.dataFim)})`
      : "";
    document.getElementById("nome-trimestre-atual").textContent = `${trimestreAtivo.nome}${periodo}`;
  } catch (erro) {
    console.error(erro);
    document.getElementById("nome-trimestre-atual").textContent = "Não foi possível carregar o trimestre.";
  }
}

function abrirModalTrimestre() {
  document.getElementById("trimestre-nome").value = "";
  document.getElementById("trimestre-inicio").value = "";
  document.getElementById("trimestre-fim").value = "";
  document.querySelector('input[name="opcao-trimestre"][value="repetir"]').checked = true;
  abrirModal("modal-trimestre");
}

async function salvarNovoTrimestre() {
  const nome = document.getElementById("trimestre-nome").value.trim();
  const dataInicio = document.getElementById("trimestre-inicio").value;
  const dataFim = document.getElementById("trimestre-fim").value;
  const opcao = document.querySelector('input[name="opcao-trimestre"]:checked').value;

  if (!nome || !dataInicio || !dataFim) {
    alert("Preencha nome, data de início e data de término do trimestre.");
    return;
  }

  try {
    const trimestreAnteriorId = trimestreAtivo ? trimestreAtivo.id : null;

    const novoRef = await db.collection("trimestres").add({
      nome,
      dataInicio,
      dataFim,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: usuarioAtual.uid,
    });

    if (opcao === "repetir" && trimestreAnteriorId) {
      // Copia os alunos do trimestre anterior para o novo, mantendo cada um na sua turma.
      const alunosAnteriores = await db.collection("alunos")
        .where("trimestreId", "==", trimestreAnteriorId)
        .get();

      const lote = db.batch();
      alunosAnteriores.docs.forEach((d) => {
        const dados = d.data();
        const novoAlunoRef = db.collection("alunos").doc();
        lote.set(novoAlunoRef, {
          nome: dados.nome,
          dataNascimento: dados.dataNascimento || null,
          contato: dados.contato || null,
          turmaId: dados.turmaId,
          trimestreId: novoRef.id,
          criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
        });
      });
      await lote.commit();
    }

    trimestreAtivo = { id: novoRef.id, nome, dataInicio, dataFim };
    fecharModal("modal-trimestre");
    await carregarTrimestreAtivo();
    carregarTurmas();
    alert(`Trimestre "${nome}" iniciado! ${opcao === "repetir" ? "Os alunos foram mantidos nas turmas." : "As turmas começam vazias para nova matrícula."}`);
  } catch (erro) {
    console.error(erro);
    alert("Não foi possível iniciar o novo trimestre. Tente novamente.");
  }
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

  try {
    // Nota: não usamos .orderBy() aqui de propósito — combinar where + orderBy em campos
    // diferentes exigiria um índice combinado no Firestore. Ordenamos no próprio navegador.
    let query = db.collection("alunos").where("turmaId", "==", turmaSelecionada.id);
    if (trimestreAtivo) query = query.where("trimestreId", "==", trimestreAtivo.id);
    const snap = await query.get();
    if (snap.empty) {
      lista.innerHTML = '<div class="vazio">Nenhum aluno matriculado nesta turma neste trimestre.</div>';
      return;
    }
    const alunos = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

    lista.innerHTML = "";
    alunos.forEach((a) => {
      const el = document.createElement("div");
      el.className = "lista-item";
      el.innerHTML = `
        <div class="info">
          <b>${escapeHtml(a.nome)} ${ehAniversarianteNaSemana(a.dataNascimento) ? '<span class="selo aniversario">🎂 Aniversário</span>' : ""}</b>
          ${a.contato ? `<span>${escapeHtml(a.contato)}</span>` : ""}
        </div>
        <div class="acoes">
          <button class="excluir" onclick="excluirAluno('${a.id}')">Remover</button>
        </div>`;
      lista.appendChild(el);
    });
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = '<div class="vazio">Não foi possível carregar os alunos. Tente novamente.</div>';
  }
}

function abrirModalAluno() {
  document.getElementById("aluno-nome").value = "";
  document.getElementById("aluno-nascimento").value = "";
  document.getElementById("aluno-contato").value = "";
  abrirModal("modal-aluno");
}

async function salvarAluno() {
  const nome = document.getElementById("aluno-nome").value.trim();
  const nascimento = document.getElementById("aluno-nascimento").value; // formato AAAA-MM-DD ou ""
  const contato = document.getElementById("aluno-contato").value.trim();
  if (!nome) { alert("Informe o nome do aluno."); return; }

  try {
    await db.collection("alunos").add({
      nome,
      dataNascimento: nascimento || null,
      contato: contato || null,
      turmaId: turmaSelecionada.id,
      trimestreId: trimestreAtivo ? trimestreAtivo.id : null,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
    });
    fecharModal("modal-aluno");
    carregarAlunos();
  } catch (erro) {
    console.error(erro);
    alert("Não foi possível salvar o aluno. Verifique sua conexão e tente novamente.");
  }
}

/* Aniversariante da semana: compara dia/mês do aluno com os últimos 7 dias
   (pensando na aula de domingo, cobre a semana anterior inteira). */
function ehAniversarianteNaSemana(dataNascimentoISO) {
  if (!dataNascimentoISO) return false;
  const partes = dataNascimentoISO.split("-"); // ["AAAA","MM","DD"]
  if (partes.length !== 3) return false;
  const mesNasc = parseInt(partes[1], 10);
  const diaNasc = parseInt(partes[2], 10);

  const hoje = new Date();
  for (let i = 0; i < 7; i++) {
    const dia = new Date(hoje);
    dia.setDate(hoje.getDate() - i);
    if (dia.getMonth() + 1 === mesNasc && dia.getDate() === diaNasc) return true;
  }
  return false;
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

  try {
    // Nota: sem .orderBy() aqui de propósito (veja explicação em carregarAlunos).
    let queryAlunos = db.collection("alunos").where("turmaId", "==", turmaSelecionada.id);
    if (trimestreAtivo) queryAlunos = queryAlunos.where("trimestreId", "==", trimestreAtivo.id);
    const [alunosSnap, presencaSnap] = await Promise.all([
      queryAlunos.get(),
      db.collection("presencas").doc(`${turmaSelecionada.id}_${data}`).get(),
    ]);

    if (alunosSnap.empty) {
      lista.innerHTML = '<div class="vazio">Cadastre alunos nesta turma antes de fazer a chamada.</div>';
      return;
    }

    const presencaSalva = presencaSnap.exists ? presencaSnap.data().presenca || {} : {};
    const dadosSalvos = presencaSnap.exists ? presencaSnap.data() : {};
    document.getElementById("chamada-revistas").value = dadosSalvos.revistas ?? "";
    document.getElementById("chamada-biblias").value = dadosSalvos.biblias ?? "";
    document.getElementById("chamada-visitantes").value = dadosSalvos.visitantes ?? "";
    document.getElementById("chamada-oferta").value = dadosSalvos.oferta ?? "";
    document.getElementById("btn-excluir-chamada").style.display = presencaSnap.exists ? "inline-flex" : "none";

    const alunos = alunosSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));

    lista.innerHTML = "";
    alunos.forEach((a) => {
      const estado = presencaSalva[a.id]; // true, false ou undefined
      const el = document.createElement("div");
      el.className = "lista-item";
      el.innerHTML = `
        <div class="info"><b>${escapeHtml(a.nome)} ${ehAniversarianteNaSemana(a.dataNascimento) ? '<span class="selo aniversario">🎂</span>' : ""}</b></div>
        <div class="toggle-presenca" data-aluno="${a.id}">
          <button type="button" class="sel-presente ${estado === true ? "on" : ""}" onclick="marcarPresenca('${a.id}', true)">Presente</button>
          <button type="button" class="sel-ausente ${estado === false ? "on" : ""}" onclick="marcarPresenca('${a.id}', false)">Ausente</button>
        </div>`;
      lista.appendChild(el);
    });
  } catch (erro) {
    console.error(erro);
    lista.innerHTML = '<div class="vazio">Não foi possível carregar a chamada. Tente novamente.</div>';
  }
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

  const revistas = parseInt(document.getElementById("chamada-revistas").value, 10) || 0;
  const biblias = parseInt(document.getElementById("chamada-biblias").value, 10) || 0;
  const visitantes = parseInt(document.getElementById("chamada-visitantes").value, 10) || 0;
  const oferta = parseFloat(document.getElementById("chamada-oferta").value) || 0;

  await docRef.set({
    turmaId: turmaSelecionada.id,
    turmaNome: turmaSelecionada.nome,
    trimestreId: trimestreAtivo ? trimestreAtivo.id : null,
    data,
    presenca: presencaFinal,
    revistas,
    biblias,
    visitantes,
    oferta,
    registradoPor: usuarioAtual.uid,
    atualizadoEm: firebase.firestore.FieldValue.serverTimestamp(),
  });

  Object.keys(presencaEmEdicao).forEach((k) => delete presencaEmEdicao[k]);
  document.getElementById("btn-excluir-chamada").style.display = "inline-flex";
  alert("Chamada e dados da aula salvos!");
}

async function excluirChamada() {
  const data = document.getElementById("data-chamada").value;
  if (!data) return;
  if (!confirm(`Excluir a chamada de ${formatarDataBR(data)} desta turma? Essa ação não pode ser desfeita.`)) return;

  try {
    await db.collection("presencas").doc(`${turmaSelecionada.id}_${data}`).delete();
    Object.keys(presencaEmEdicao).forEach((k) => delete presencaEmEdicao[k]);
    alert("Chamada excluída.");
    carregarChamada();
  } catch (erro) {
    console.error(erro);
    alert("Não foi possível excluir a chamada. Tente novamente.");
  }
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
  const rotulo = document.getElementById("rotulo-turma-usuario");
  const dica = document.getElementById("dica-turma-usuario");
  // O campo de turma agora fica disponível para qualquer papel: um coordenador ou
  // pastor também pode lecionar uma turma, além de ter acesso completo ao sistema.
  document.getElementById("campo-turma-usuario").style.display = "block";
  if (papel === "professor") {
    rotulo.textContent = "Turma que irá lecionar";
    dica.style.display = "none";
  } else {
    rotulo.textContent = "Também leciona uma turma? (opcional)";
    dica.style.display = "block";
  }
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
      turmaId: turmaId || null,
      criadoEm: firebase.firestore.FieldValue.serverTimestamp(),
      criadoPor: usuarioAtual.uid,
    });

    if (turmaId) {
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
/* RELATÓRIO / FECHAMENTO DO DOMINGO (somente coordenador e pastor)         */
/* ---------------------------------------------------------------------- */

async function carregarRelatorio() {
  const container = document.getElementById("relatorio-conteudo");
  container.innerHTML = '<div class="carregando">Calculando o fechamento...</div>';

  const data = document.getElementById("data-relatorio").value;
  if (!data) { container.innerHTML = '<div class="vazio">Selecione uma data.</div>'; return; }

  try {
    const turmasSnap = await db.collection("turmas").get();
    if (turmasSnap.empty) {
      container.innerHTML = '<div class="vazio">Nenhuma turma cadastrada ainda.</div>';
      return;
    }

    const linhas = await Promise.all(turmasSnap.docs.map(async (docTurma) => {
      const turma = { id: docTurma.id, ...docTurma.data() };
      const [alunosSnap, presencaDoc] = await Promise.all([
        db.collection("alunos").where("turmaId", "==", turma.id).get(),
        db.collection("presencas").doc(`${turma.id}_${data}`).get(),
      ]);

      const matriculados = alunosSnap.size;
      const dadosAula = presencaDoc.exists ? presencaDoc.data() : {};
      const presencaMapa = dadosAula.presenca || {};
      const presentes = Object.values(presencaMapa).filter((v) => v === true).length;
      const ausentes = matriculados - presentes;

      return {
        turmaId: turma.id,
        nome: turma.nome,
        matriculados,
        presentes,
        ausentes: ausentes < 0 ? 0 : ausentes,
        revistas: dadosAula.revistas || 0,
        biblias: dadosAula.biblias || 0,
        visitantes: dadosAula.visitantes || 0,
        oferta: dadosAula.oferta || 0,
        temRegistro: presencaDoc.exists,
      };
    }));

    renderizarRelatorio(linhas, data);
  } catch (erro) {
    console.error(erro);
    container.innerHTML = '<div class="vazio">Não foi possível calcular o relatório. Tente novamente.</div>';
  }
}

function renderizarRelatorio(linhas, data) {
  const container = document.getElementById("relatorio-conteudo");

  const totais = linhas.reduce((acc, l) => ({
    matriculados: acc.matriculados + l.matriculados,
    presentes: acc.presentes + l.presentes,
    ausentes: acc.ausentes + l.ausentes,
    revistas: acc.revistas + l.revistas,
    biblias: acc.biblias + l.biblias,
    visitantes: acc.visitantes + l.visitantes,
    oferta: acc.oferta + l.oferta,
  }), { matriculados: 0, presentes: 0, ausentes: 0, revistas: 0, biblias: 0, visitantes: 0, oferta: 0 });

  const linhasComRegistro = linhas.filter((l) => l.temRegistro);

  if (linhasComRegistro.length === 0) {
    container.innerHTML = `
      <div class="vazio">Nenhuma turma registrou a chamada deste domingo (${formatarDataBR(data)}) ainda.</div>`;
    return;
  }

  const campeaDe = (campo) => {
    return linhasComRegistro.reduce((melhor, atual) => (atual[campo] > (melhor ? melhor[campo] : -1) ? atual : melhor), null);
  };

  const categorias = [
    { campo: "presentes", rotulo: "Mais presença", formato: (v) => `${v} presentes` },
    { campo: "oferta", rotulo: "Mais oferta", formato: (v) => formatarMoeda(v) },
    { campo: "revistas", rotulo: "Mais revistas", formato: (v) => `${v} revistas` },
    { campo: "biblias", rotulo: "Mais bíblias", formato: (v) => `${v} bíblias` },
    { campo: "visitantes", rotulo: "Mais visitantes", formato: (v) => `${v} visitantes` },
  ];

  let html = `<div class="campeas-grid">`;
  categorias.forEach((cat) => {
    const vencedora = campeaDe(cat.campo);
    html += `
      <div class="campea-card">
        <div class="rotulo">🏆 ${cat.rotulo}</div>
        <div class="nome-turma">${vencedora ? escapeHtml(vencedora.nome) : "—"}</div>
        <div class="valor-destaque">${vencedora ? cat.formato(vencedora[cat.campo]) : "sem dados"}</div>
      </div>`;
  });
  html += `</div>`;

  html += `<div class="tabela-wrap"><table class="tabela-relatorio">
    <thead><tr>
      <th>Turma</th><th>Matriculados</th><th>Presentes</th><th>Ausentes</th>
      <th>Revistas</th><th>Bíblias</th><th>Visitantes</th><th>Oferta</th>
    </tr></thead><tbody>`;

  linhas.forEach((l) => {
    html += `<tr>
      <td>${escapeHtml(l.nome)}${!l.temRegistro ? ' <span class="selo">sem chamada</span>' : ""}</td>
      <td>${l.matriculados}</td><td>${l.presentes}</td><td>${l.ausentes}</td>
      <td>${l.revistas}</td><td>${l.biblias}</td><td>${l.visitantes}</td><td>${formatarMoeda(l.oferta)}</td>
    </tr>`;
  });

  html += `</tbody><tfoot><tr>
      <td>Total geral</td><td>${totais.matriculados}</td><td>${totais.presentes}</td><td>${totais.ausentes}</td>
      <td>${totais.revistas}</td><td>${totais.biblias}</td><td>${totais.visitantes}</td><td>${formatarMoeda(totais.oferta)}</td>
    </tr></tfoot></table></div>`;

  container.innerHTML = html;
}

function formatarMoeda(valor) {
  return (valor || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataBR(dataISO) {
  const [ano, mes, dia] = dataISO.split("-");
  return `${dia}/${mes}/${ano}`;
}

/* ---------------------------------------------------------------------- */
/* HISTÓRICO MENSAL (somente coordenador e pastor)                          */
/* ---------------------------------------------------------------------- */

async function carregarFiltroTurmasHistorico() {
  const select = document.getElementById("historico-turma");
  const valorAtual = select.value;
  select.innerHTML = '<option value="">Todas as turmas</option>';
  const snap = await db.collection("turmas").get();
  snap.docs.forEach((d) => {
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nome;
    select.appendChild(opt);
  });
  select.value = valorAtual || "";
}

async function carregarHistorico() {
  const mesInput = document.getElementById("historico-mes").value; // formato AAAA-MM
  const turmaFiltro = document.getElementById("historico-turma").value; // turmaId ou ""
  const container = document.getElementById("historico-conteudo");

  if (!mesInput) { container.innerHTML = '<div class="vazio">Selecione um mês.</div>'; return; }
  container.innerHTML = '<div class="carregando">Carregando dados do mês...</div>';

  try {
    // Buscamos por turma (se filtrado) ou tudo, e filtramos o mês no navegador —
    // evita a necessidade de índices combinados no Firestore.
    let query = db.collection("presencas");
    if (turmaFiltro) query = query.where("turmaId", "==", turmaFiltro);
    const snap = await query.get();

    const registros = snap.docs.map((d) => d.data()).filter((r) => (r.data || "").startsWith(mesInput));

    if (registros.length === 0) {
      destruirGraficosHistorico();
      container.innerHTML = '<div class="vazio">Nenhuma chamada registrada neste mês (com esse filtro).</div>';
      return;
    }

    const porData = {};
    registros.forEach((r) => {
      if (!porData[r.data]) porData[r.data] = { presentes: 0, oferta: 0, revistas: 0, biblias: 0, visitantes: 0 };
      const presentesDoRegistro = Object.values(r.presenca || {}).filter((v) => v === true).length;
      porData[r.data].presentes += presentesDoRegistro;
      porData[r.data].oferta += r.oferta || 0;
      porData[r.data].revistas += r.revistas || 0;
      porData[r.data].biblias += r.biblias || 0;
      porData[r.data].visitantes += r.visitantes || 0;
    });

    const datasOrdenadas = Object.keys(porData).sort();
    const rotulos = datasOrdenadas.map(formatarDataBR);
    const serie = (campo) => datasOrdenadas.map((d) => porData[d][campo]);
    const somar = (arr) => arr.reduce((a, b) => a + b, 0);

    const totalPresentes = somar(serie("presentes"));
    const totalOferta = somar(serie("oferta"));
    const totalRevistas = somar(serie("revistas"));
    const totalBiblias = somar(serie("biblias"));
    const totalVisitantes = somar(serie("visitantes"));

    container.innerHTML = `
      <div class="campeas-grid">
        <div class="campea-card"><div class="rotulo">Presenças no mês</div><div class="nome-turma">${totalPresentes}</div></div>
        <div class="campea-card"><div class="rotulo">Oferta no mês</div><div class="nome-turma">${formatarMoeda(totalOferta)}</div></div>
        <div class="campea-card"><div class="rotulo">Revistas usadas</div><div class="nome-turma">${totalRevistas}</div></div>
        <div class="campea-card"><div class="rotulo">Bíblias trazidas</div><div class="nome-turma">${totalBiblias}</div></div>
        <div class="campea-card"><div class="rotulo">Visitantes</div><div class="nome-turma">${totalVisitantes}</div></div>
      </div>
      <div class="grafico-card"><h3>Presença por domingo</h3><canvas id="grafico-presenca"></canvas></div>
      <div class="grafico-card"><h3>Oferta por domingo (R$)</h3><canvas id="grafico-oferta"></canvas></div>
    `;

    destruirGraficosHistorico();

    const ctxPresenca = document.getElementById("grafico-presenca").getContext("2d");
    graficosHistorico.push(new Chart(ctxPresenca, {
      type: "line",
      data: { labels: rotulos, datasets: [{ label: "Presentes", data: serie("presentes"), borderColor: "#1E3A5F", backgroundColor: "#1E3A5F", tension: .3 }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
    }));

    const ctxOferta = document.getElementById("grafico-oferta").getContext("2d");
    graficosHistorico.push(new Chart(ctxOferta, {
      type: "bar",
      data: { labels: rotulos, datasets: [{ label: "Oferta (R$)", data: serie("oferta"), backgroundColor: "#B8933F" }] },
      options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } },
    }));
  } catch (erro) {
    console.error(erro);
    container.innerHTML = '<div class="vazio">Não foi possível carregar o histórico. Tente novamente.</div>';
  }
}

function destruirGraficosHistorico() {
  graficosHistorico.forEach((g) => g.destroy());
  graficosHistorico = [];
}

function exportarRelatorioPDF() {
  const data = document.getElementById("data-relatorio").value;
  if (!data || document.getElementById("relatorio-conteudo").innerHTML.trim() === "") {
    alert("Escolha uma data com fechamento registrado antes de exportar.");
    return;
  }
  document.title = `Fechamento EBD - ${formatarDataBR(data)}`;
  window.print();
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
