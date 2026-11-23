#!/usr/bin/env bash
# Sunucuya yayin: git archive | ssh ile kopyalar, docker compose ile yeniden derler.
# Kullanim: bash scripts/deploy.sh --help
set -euo pipefail

CONTAINER="harcama-takip"
HEALTH_TIMEOUT=120

REF="HEAD"
SKIP_CHECKS=0
DRY_RUN=0
ASSUME_YES=0

usage() {
  cat <<'USAGE'
Kullanim: bash scripts/deploy.sh [secenekler]

Secenekler:
  --ref <commit|tag>  Yayinlanacak ref (varsayilan: HEAD)
  --skip-checks       Yerel lint/typecheck/test adimini atla
  --dry-run           Uzak komut calistirmadan yapilacaklari yazdir (ssh cagrilmaz)
  --yes               Onay sorularini otomatik evet say
  -h, --help          Bu yardimi goster

Yapilandirma (ortam degiskeni veya repo kokundeki .deploy.env):
  DEPLOY_TARGET       Zorunlu. Ornek: kullanici@sunucu
  DEPLOY_PATH         Zorunlu. Sunucudaki uygulama dizini (tek tirnak icermemeli)
  DEPLOY_HEALTH_URL   Opsiyonel. Ornek: http://sunucu:4001/api/health
USAGE
}

log() { printf '%s\n' "$*"; }
warn() { printf 'UYARI: %s\n' "$*" >&2; }
die() { printf 'HATA: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --ref)
      [ $# -ge 2 ] || die "--ref bir deger bekler."
      REF="$2"; shift 2 ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "Bilinmeyen secenek: $1" ;;
  esac
done

confirm() {
  [ "$ASSUME_YES" -eq 1 ] && return 0
  if [ ! -t 0 ]; then
    die "Onay gerekiyor ama etkilesimli terminal yok. --yes kullanin."
  fi
  local ans
  read -r -p "$1 [e/H] " ans
  case "$ans" in e|E|evet|Evet) return 0 ;; *) die "Kullanici iptal etti." ;; esac
}

# --- 1. On kontroller ---------------------------------------------------
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || die "Bir git deposunda degilsiniz."
cd "$TOP"

if [ -f .deploy.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.deploy.env
  set +a
fi

DEPLOY_TARGET="${DEPLOY_TARGET:-}"
DEPLOY_PATH="${DEPLOY_PATH:-}"
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-}"

[ -n "$DEPLOY_TARGET" ] || die "DEPLOY_TARGET tanimli degil (ortam degiskeni veya .deploy.env)."
[ -n "$DEPLOY_PATH" ] || die "DEPLOY_PATH tanimli degil (ortam degiskeni veya .deploy.env)."
case "$DEPLOY_PATH" in
  *"'"*) die "DEPLOY_PATH tek tirnak iceremez." ;;
  *$'\n'*) die "DEPLOY_PATH satir sonu iceremez." ;;
esac
case "$DEPLOY_TARGET" in
  -*|*[[:space:]]*) die "DEPLOY_TARGET gecersiz (tire ile baslayamaz, bosluk icermemeli)." ;;
esac

COMMIT="$(git rev-parse --verify --quiet "${REF}^{commit}")" || die "Ref bulunamadi: $REF"
SHORT="$(git rev-parse --short "$COMMIT")"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  die "Calisma agaci temiz degil (takipli dosyalarda degisiklik var). Commit veya stash yapin."
fi

if git rev-parse --verify --quiet origin/main >/dev/null; then
  if ! git merge-base --is-ancestor "$COMMIT" origin/main; then
    warn "$SHORT, origin/main icinde degil (push edilmemis veya CI'dan gecmemis olabilir)."
    confirm "Yine de yayinlansin mi?"
  fi
else
  warn "origin/main bulunamadi; $SHORT'in CI'dan gectigi dogrulanamadi."
  confirm "Yine de yayinlansin mi?"
fi

log "Yayinlanacak: $SHORT ($REF) -> $DEPLOY_TARGET:$DEPLOY_PATH"

# --- 2. Yerel dogrulama -------------------------------------------------
if [ "$SKIP_CHECKS" -eq 1 ]; then
  log "[atlandi] Yerel dogrulama (--skip-checks)"
else
  if [ "$DRY_RUN" -eq 1 ]; then
    log "[dry-run] Calistirilacak: npm run lint && npm run typecheck && npm test"
  else
    log "Yerel dogrulama: lint, typecheck, test..."
    npm run lint && npm run typecheck && npm test
  fi
fi

# --- 3-6. Uzak islemler -------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  log "[dry-run] ssh cagrilmaz. Yapilacaklar:"
  log "  1. Sunucuda $DEPLOY_PATH/.deployed-commit var mi kontrol edilir"
  log "  2. git archive --format=tar $SHORT | ssh $DEPLOY_TARGET \"mkdir -p '$DEPLOY_PATH' && tar -x -C '$DEPLOY_PATH'\""
  log "  3. Sunucuda .env kontrolu (yoksa durur), sonra: docker compose up -d --build"
  log "  4. docker inspect ile '$CONTAINER' healthy olana kadar en fazla ${HEALTH_TIMEOUT} sn beklenir"
  if [ -n "$DEPLOY_HEALTH_URL" ]; then
    log "  5. Yerelden: curl -fsS $DEPLOY_HEALTH_URL"
  else
    log "  5. DEPLOY_HEALTH_URL tanimsiz: dis kontrol yapilmaz"
  fi
  log "  6. Sunucuda $DEPLOY_PATH/.deployed-commit dosyasina $COMMIT yazilir"
  exit 0
fi

FIRST_DEPLOY=0
if ! ssh "$DEPLOY_TARGET" "test -f '$DEPLOY_PATH/.deployed-commit'"; then
  FIRST_DEPLOY=1
  warn ".deployed-commit yok: ilk script'li yayin. Volume daha once root ile olustuysa"
  warn "README'deki 'Root olmayan kullaniciya gecis' (chown) adimini bir kez elle yapmis olmalisiniz."
fi

log "Dosyalar kopyalaniyor..."
git archive --format=tar "$COMMIT" | ssh "$DEPLOY_TARGET" "mkdir -p '$DEPLOY_PATH' && tar -x -C '$DEPLOY_PATH'"

log "Sunucuda derleniyor ve baslatiliyor..."
ssh "$DEPLOY_TARGET" "bash -s" <<REMOTE
set -u
cd '$DEPLOY_PATH' || exit 10
if [ ! -f .env ]; then
  echo "HATA: $DEPLOY_PATH/.env yok. Ilk kurulumu README'ye gore elle yapin." >&2
  exit 11
fi
docker compose up -d --build || exit 12
deadline=\$(( \$(date +%s) + $HEALTH_TIMEOUT ))
status=""
while :; do
  status=\$(docker inspect -f '{{.State.Health.Status}}' $CONTAINER 2>/dev/null || echo "yok")
  [ "\$status" = "healthy" ] && break
  if [ "\$status" = "unhealthy" ] || [ "\$(date +%s)" -ge "\$deadline" ]; then
    echo "HATA: container durumu '\$status' (healthy beklendi). Son 50 satir log:" >&2
    docker compose logs --tail=50 >&2
    exit 13
  fi
  sleep 3
done
printf '%s\n' '$COMMIT' > .deployed-commit
echo "Container healthy."
REMOTE

if [ -n "$DEPLOY_HEALTH_URL" ]; then
  log "Dis kontrol: $DEPLOY_HEALTH_URL"
  curl -fsS --max-time 15 --retry 5 --retry-delay 3 --retry-connrefused "$DEPLOY_HEALTH_URL" >/dev/null \
    || die "Dis health kontrolu basarisiz: $DEPLOY_HEALTH_URL"
  log "Dis kontrol basarili."
fi

NOW="$(date '+%Y-%m-%d %H:%M')"
log ""
log "Yayin tamamlandi: $SHORT ($NOW)"
[ "$FIRST_DEPLOY" -eq 1 ] && log "(.deployed-commit sunucuya ilk kez yazildi)"
log "memory.md icin onerilen satir:"
log "- $NOW | Sunucuya $SHORT yuklendi (scripts/deploy.sh), container healthy."
