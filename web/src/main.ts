import "./style.css";
import { fetchArrivals, geocode, reverseGeocode, type StationArrivals } from "./api";
import { config } from "./config";
import { type BusDb, type Station, loadDb } from "./data";
import { initMap, type MapView } from "./map";
import { type Place, directionHint, looksLikeAddress, searchStations, stationPlace } from "./places";
import { type OptionResult, type RoutePlan, evaluate, findPlans } from "./router";
import * as store from "./storage";
import { debounce, esc, fmtClock, fmtMin, fmtWait } from "./util";

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const LEG_COLORS = ["#0f766e", "#c2410c"];

const state = {
  db: null as BusDb | null,
  map: null as MapView | null,
  from: null as Place | null,
  to: null as Place | null,
  mode: "transfer" as "transfer" | "direct",
  plans: [] as RoutePlan[],
  results: [] as OptionResult[],
  /** 즐겨찾기를 연 경우 그 ID (결과 제목 표시용) */
  favoriteId: null as string | null,
  open: new Set<number>(),
  board: null as { station: Station; arrivals: StationArrivals } | null,
  loading: false,
  error: "",
  lastUpdated: 0,
};

// ---------- 시작 ----------

async function start() {
  status("정류장 정보를 불러오는 중…");
  try {
    state.db = await loadDb();
  } catch (e) {
    status(`정류장 정보를 불러오지 못했습니다: ${String(e)}`);
    return;
  }
  const db = state.db;
  $("#footer").textContent = `정류장 정보 기준: ${new Date(db.updatedAt).toLocaleDateString("ko-KR")} · 성남시 정류장 ${db.selectable.length.toLocaleString()}곳 · 노선 ${db.routes.size}개${db.partial ? " · 일부 정류장 수집 중" : ""}`;

  initMap($("#map"), db, (s) => directionHint(db, s), (place, role) => setPlace(role, place), reverseGeocode)
    .then((m) => { state.map = m; m?.setEndpoints(state.from, state.to); })
    .catch((e) => status(`지도를 불러오지 못했습니다: ${String(e)}`));

  setupInputs();
  renderPairs();
  renderFavorites();
  status("");
  setInterval(tick, 1000);
  setInterval(() => { if (document.visibilityState === "visible") refresh(); }, config.refreshMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - state.lastUpdated > config.refreshMs) refresh();
  });
}

function status(text: string) {
  $("#status").textContent = text;
}

// ---------- 입력·자동완성 ----------

function setupInputs() {
  for (const role of ["from", "to"] as const) {
    const input = $<HTMLInputElement>(`#${role}`);
    const list = $<HTMLUListElement>(`#${role}-suggest`);
    let items: Place[] = [];

    const show = (places: Place[], hints: string[]) => {
      items = places;
      list.innerHTML = places
        .map((p, i) => `<li data-i="${i}"><span class="kind kind-${p.kind}">${p.kind === "station" ? "정류장" : "주소"}</span>
          <span class="sg-main">${esc(p.label)}</span>${hints[i] ? `<small>${esc(hints[i])}</small>` : ""}</li>`)
        .join("");
      list.hidden = places.length === 0;
    };

    const lookup = debounce(async (q: string, base: Place[], hints: string[]) => {
      const found = await geocode(q).catch(() => []);
      if (input.value.trim() !== q) return;
      const addr = found.slice(0, 4).map<Place>((a) => ({
        kind: "point",
        label: (a.roadAddress ?? a.jibunAddress ?? q).replace(/^경기도\s*/, ""),
        lat: a.lat,
        lng: a.lng,
      }));
      show([...base, ...addr], [...hints, ...addr.map(() => "")]);
    }, 300);

    input.addEventListener("input", () => {
      const q = input.value.trim();
      if (!state.db || q.length < 1) { show([], []); return; }
      const stations = searchStations(state.db, q, 7);
      const places = stations.map(stationPlace);
      const hints = stations.map((s) => directionHint(state.db!, s));
      show(places, hints);
      if (q.length >= 2 && looksLikeAddress(q)) lookup(q, places, hints);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (items[0]) pick(items[0]);
      } else if (e.key === "Escape") list.hidden = true;
    });
    input.addEventListener("focus", () => input.select());
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 150));
    list.addEventListener("mousedown", (e) => {
      const li = (e.target as HTMLElement).closest("li");
      if (li) { e.preventDefault(); pick(items[Number(li.dataset.i)]); }
    });

    function pick(p: Place) {
      list.hidden = true;
      setPlace(role, p);
      if (role === "from" && !state.to) $<HTMLInputElement>("#to").focus();
      else input.blur();
    }
  }

  document.querySelectorAll<HTMLButtonElement>("[data-clear]").forEach((b) =>
    b.addEventListener("click", () => {
      const role = b.dataset.clear as "from" | "to";
      state[role] = null;
      $<HTMLInputElement>(`#${role}`).value = "";
      clearResults();
      afterPlaceChange(false);
      $<HTMLInputElement>(`#${role}`).focus();
    }),
  );
  $("#swap").addEventListener("click", () => {
    [state.from, state.to] = [state.to, state.from];
    afterPlaceChange(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      state.mode = b.dataset.mode as "transfer" | "direct";
      document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      if (!state.favoriteId) search();
    }),
  );
  $("#refresh").addEventListener("click", () => refresh());
  $("#search").addEventListener("submit", (e) => e.preventDefault());
}

function setPlace(role: "from" | "to", place: Place) {
  state[role] = place;
  afterPlaceChange(true);
}

function afterPlaceChange(runSearch: boolean) {
  $<HTMLInputElement>("#from").value = state.from?.label ?? "";
  $<HTMLInputElement>("#to").value = state.to?.label ?? "";
  state.map?.setEndpoints(state.from, state.to);
  state.favoriteId = null;
  loadBoard();
  if (runSearch) search();
}

// ---------- 검색 ----------

function clearResults() {
  state.plans = [];
  state.results = [];
  state.open.clear();
  state.map?.showPath([]);
  renderResults();
}

async function search() {
  const { db, from, to } = state;
  if (!db || !from || !to) { clearResults(); return; }
  store.savePair(from, to);
  renderPairs();
  state.favoriteId = null;
  state.plans = findPlans(db, from, to, state.mode === "transfer");
  state.open.clear();
  if (state.plans.length === 0) {
    state.results = [];
    state.error = state.mode === "direct"
      ? "직행 버스가 없습니다. ‘환승 포함’으로 찾아보세요."
      : "1회 환승으로 갈 수 있는 경로를 찾지 못했습니다.";
    renderResults();
    return;
  }
  await refreshResults();
  if (state.results.length) state.open.add(0);
  renderResults();
  drawPath(0);
}

async function refreshResults() {
  if (!state.db || state.plans.length === 0) return;
  state.loading = true;
  state.error = "";
  renderResults();
  try {
    const keepOpen = new Set([...state.open].map((i) => store.favoriteKey(state.results[i]?.plan ?? state.plans[0])));
    state.results = (await evaluate(state.db, state.plans)).slice(0, 8);
    state.open = new Set(state.results.flatMap((r, i) => (keepOpen.has(store.favoriteKey(r.plan)) ? [i] : [])));
    state.lastUpdated = Date.now();
    if (state.results.length === 0) state.error = "지금 운행 중인 버스로 갈 수 있는 경로가 없습니다.";
  } catch (e) {
    state.error = `실시간 정보를 가져오지 못했습니다: ${String(e)}`;
  }
  state.loading = false;
  renderResults();
}

async function refresh() {
  await Promise.all([refreshResults(), loadBoard()]);
}

// ---------- 출발 정류장 실시간 도착 (FR-4.5) ----------

async function loadBoard() {
  const { db, from } = state;
  if (!db || !from) { state.board = null; renderBoard(); return; }
  const station = from.kind === "station"
    ? db.stations.get(from.stationId)
    : db.grid.near(from.lat, from.lng, 500)[0]?.station;
  if (!station) { state.board = null; renderBoard(); return; }
  try {
    const arrivals = await fetchArrivals(station.id, 10_000);
    state.board = { station, arrivals };
  } catch {
    state.board = null;
  }
  renderBoard();
}

function renderBoard() {
  const el = $("#board");
  const b = state.board;
  if (!b) { el.innerHTML = ""; return; }
  const elapsed = (Date.now() - b.arrivals.fetchedAt) / 1000;
  const rows = b.arrivals.routes
    .map((r) => ({ r, secs: r.arrivals.map((a) => Math.max(0, Math.round(a.seconds - elapsed))) }))
    .sort((a, b2) => (a.secs[0] ?? 1e9) - (b2.secs[0] ?? 1e9) || a.r.routeName.localeCompare(b2.r.routeName, "ko", { numeric: true }));
  el.innerHTML = `<h3>${esc(b.station.name)} <small>${esc(b.station.no)} · ${esc(directionHint(state.db!, b.station))}</small></h3>
    <ul class="board">${rows.map(({ r, secs }) => `<li><span class="bus">${esc(r.routeName)}</span>
      <span>${secs.length ? secs.map((s) => fmtWait(s)).join(" · ") : '<span class="muted">도착 정보 없음</span>'}</span></li>`).join("")}</ul>`;
}

// ---------- 결과 ----------

function renderResults() {
  const el = $("#results");
  const parts: string[] = [];
  if (state.favoriteId) {
    const f = store.getFavorites().find((x) => x.id === state.favoriteId);
    if (f) parts.push(`<li class="res-title">★ ${esc(f.name)}</li>`);
  }
  if (state.error) parts.push(`<li class="msg">${esc(state.error)}</li>`);
  if (state.loading && state.results.length === 0) parts.push(`<li class="msg">실시간 정보를 확인하는 중…</li>`);
  state.results.forEach((r, i) => parts.push(renderOption(r, i)));
  el.innerHTML = parts.join("");
  updateStatus();
}

function renderOption(r: OptionResult, i: number): string {
  const since = (Date.now() - r.evaluatedAt) / 1000;
  const left = (s: number | null) => (s === null ? null : Math.max(0, Math.round(s - since)));
  const arrive = left(r.arriveSec);
  const first = r.legs[0];
  const firstBoard = left(first.boardSec);
  const walk = r.plan.walkStartSec + r.plan.walkTransferSec + r.plan.walkEndSec;
  const open = state.open.has(i);
  const fav = store.isFavorite(r.plan);
  const chips = r.legs.map((l, n) => `<span class="bus" style="--c:${LEG_COLORS[n]}">${esc(l.route.name)}</span>`).join('<span class="arrow">→</span>');

  const steps: string[] = [];
  if (r.plan.walkStartSec > 0) steps.push(`<li class="walk">걸어서 ${fmtMin(r.plan.walkStartSec)} → ${esc(first.from.name)}</li>`);
  r.legs.forEach((l, n) => {
    if (n === 1) steps.push(`<li class="walk">환승: ${esc(r.legs[0].to.name)} 하차${l.from.id !== r.legs[0].to.id ? ` → 걸어서 ${fmtMin(r.plan.walkTransferSec)} → ${esc(l.from.name)}` : ""}</li>`);
    const board = left(l.boardSec);
    const wait = l.waitSec;
    steps.push(`<li class="ride" style="--c:${LEG_COLORS[n]}">
      <div><span class="bus" style="--c:${LEG_COLORS[n]}">${esc(l.route.name)}</span> <small>${esc(l.route.type)}</small></div>
      <div>${esc(l.from.name)} <small>${esc(l.from.no)}</small> 승차 · <b>${board === null ? "-" : fmtWait(board) + (board >= 60 ? " 후" : " 도착")}</b>${l.boardEstimated ? ' <span class="est">추정</span>' : ""}
        ${n === 1 && wait !== null ? `<small>(환승 대기 ${fmtMin(wait)})</small>` : ""}</div>
      <div class="muted">실시간: ${l.upcoming.length ? l.upcoming.map((s) => fmtWait(Math.max(0, Math.round(s - since)))).join(" · ") : "정보 없음"}</div>
      <div>${l.stops}정거장 · 탑승 약 ${fmtMin(l.rideSec)}${l.rideEstimated ? ' <span class="est">추정</span>' : ' <span class="live">차량 추적</span>'} → ${esc(l.to.name)} 하차</div>
    </li>`);
  });
  if (r.plan.walkEndSec > 0) steps.push(`<li class="walk">걸어서 ${fmtMin(r.plan.walkEndSec)} → 도착지</li>`);

  return `<li class="opt${open ? " open" : ""}" data-i="${i}">
    <button class="opt-head" data-act="toggle">
      <div class="opt-time"><b>${arrive === null ? "-" : fmtClock(r.evaluatedAt + (r.arriveSec ?? 0) * 1000)}</b> 도착
        <span class="muted">${arrive === null ? "" : `(${fmtMin(arrive)})`}</span>${r.estimated ? ' <span class="est">추정 포함</span>' : ""}</div>
      <div class="opt-sub">${chips}<span class="muted">${r.legs.length > 1 ? "환승 1회" : "직행"}${walk > 0 ? ` · 도보 ${fmtMin(walk)}` : ""}</span></div>
      <div class="opt-sub muted">${esc(first.from.name)}에서 ${firstBoard === null ? "-" : fmtWait(firstBoard) + (firstBoard >= 60 ? " 후 승차" : " 승차")}${r.note ? ` · ${esc(r.note)}` : ""}</div>
    </button>
    ${open ? `<ol class="steps">${steps.join("")}</ol>
      <div class="opt-actions"><button data-act="fav">${fav ? "★ 즐겨찾기됨" : "☆ 즐겨찾기"}</button><button data-act="map">지도에 표시</button></div>` : ""}
  </li>`;
}

$("#results").addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  const li = (e.target as HTMLElement).closest<HTMLElement>("li.opt");
  if (!btn || !li) return;
  const i = Number(li.dataset.i);
  const r = state.results[i];
  switch (btn.dataset.act) {
    case "toggle":
      state.open.has(i) ? state.open.delete(i) : state.open.add(i);
      if (state.open.has(i)) drawPath(i);
      break;
    case "fav":
      if (!store.isFavorite(r.plan) && state.from && state.to) store.addFavorite(state.from, state.to, r.plan);
      renderFavorites();
      break;
    case "map":
      drawPath(i);
      document.querySelector("#map")?.scrollIntoView({ behavior: "smooth" });
      break;
  }
  renderResults();
});

function drawPath(i: number) {
  const r = state.results[i];
  const db = state.db;
  if (!r || !db) return;
  state.map?.showPath(r.legs.map((l, n) => ({
    color: LEG_COLORS[n],
    coords: l.route.stops
      .slice(r.plan.legs[n].fromIndex, r.plan.legs[n].toIndex + 1)
      .map((id) => db.stations.get(id))
      .filter((s): s is Station => !!s)
      .map((s) => [s.y, s.x] as [number, number]),
  })));
}

function updateStatus() {
  if (state.loading) return status("실시간 정보 갱신 중…");
  if (!state.lastUpdated || state.results.length === 0) return status("");
  const ago = Math.round((Date.now() - state.lastUpdated) / 1000);
  status(`마지막 갱신 ${ago < 5 ? "방금" : `${ago}초 전`} · ${config.refreshMs / 1000}초마다 자동 갱신`);
}

/** 1초마다 남은 시간을 줄여 보여 준다 (ADR-015) */
function tick() {
  if (document.visibilityState !== "visible") return;
  if (state.results.length) renderResults();
  if (state.board) renderBoard();
}

// ---------- 최근 검색 · 즐겨찾기 ----------

function renderPairs() {
  const pairs = store.getPairs();
  $("#pairs").innerHTML = pairs.length
    ? `<h3>최근 검색</h3><ul class="chips">${pairs.map((p, i) => `<li><button data-pair="${i}">${esc(short(p.from.label))} → ${esc(short(p.to.label))}</button><button class="x" data-del-pair="${i}" aria-label="삭제">×</button></li>`).join("")}</ul>`
    : "";
}

$("#pairs").addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  const pairs = store.getPairs();
  if (t.dataset.pair) {
    const p = pairs[Number(t.dataset.pair)];
    state.from = p.from;
    state.to = p.to;
    afterPlaceChange(true);
  } else if (t.dataset.delPair) {
    store.removePair(Number(t.dataset.delPair));
    renderPairs();
  }
});

function renderFavorites() {
  const favs = store.getFavorites();
  $("#favorites").innerHTML = favs.length
    ? `<h3>즐겨찾기</h3><ul class="favs">${favs.map((f) => `<li><button class="fav-open" data-fav="${f.id}">
        <b>${esc(f.name)}</b><span>${f.legs.map((l) => `<span class="bus">${esc(l.routeName)}</span>`).join('<span class="arrow">→</span>')}</span></button>
        <button class="x" data-rename="${f.id}" aria-label="이름 바꾸기">✎</button><button class="x" data-del-fav="${f.id}" aria-label="삭제">×</button></li>`).join("")}</ul>`
    : "";
}

$("#favorites").addEventListener("click", async (e) => {
  const t = (e.target as HTMLElement).closest<HTMLElement>("button");
  if (!t || !state.db) return;
  if (t.dataset.delFav) {
    store.removeFavorite(t.dataset.delFav);
    renderFavorites();
    renderResults();
  } else if (t.dataset.rename) {
    const f = store.getFavorites().find((x) => x.id === t.dataset.rename);
    const name = f && prompt("즐겨찾기 이름", f.name);
    if (f && name) { store.renameFavorite(f.id, name.trim()); renderFavorites(); renderResults(); }
  } else if (t.dataset.fav) {
    const f = store.getFavorites().find((x) => x.id === t.dataset.fav);
    if (!f) return;
    const plan = store.favoriteToPlan(state.db, f);
    state.from = f.from;
    state.to = f.to;
    $<HTMLInputElement>("#from").value = f.from.label;
    $<HTMLInputElement>("#to").value = f.to.label;
    state.map?.setEndpoints(f.from, f.to);
    loadBoard();
    if (!plan) {
      state.plans = [];
      state.results = [];
      state.favoriteId = f.id;
      state.error = "노선 정보가 바뀌었습니다. 다시 검색해서 즐겨찾기를 새로 저장해 주세요.";
      renderResults();
      return;
    }
    state.plans = [plan];
    state.open = new Set([0]);
    state.favoriteId = f.id;
    await refreshResults();
    state.open = new Set([0]);
    renderResults();
    drawPath(0);
  }
});

function short(label: string) {
  return label
    .replace(/\s*\(\d+\)$/, "")
    .replace(/^(\S+시\s+)?(\S+구\s+)?/, "")
    .slice(0, 14);
}

start();
