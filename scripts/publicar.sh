#!/usr/bin/env bash
# Cria o repositório no GitHub, liga o GitHub Pages e publica o app.
# Roda uma vez. Depois disso, todo push na main republica sozinho.
#
#   GITHUB_TOKEN=ghp_... ./scripts/publicar.sh [nome-do-repositorio]
#
# O token precisa dos escopos "repo" e "workflow" (token clássico).
# Nunca é gravado em arquivo nem no histórico do git.

set -euo pipefail

REPO="${1:-contorno}"
: "${GITHUB_TOKEN:?defina GITHUB_TOKEN}"
API="https://api.github.com"
H=(-H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

cd "$(dirname "$0")/.."

echo "› Conferindo o token"
USUARIO=$(curl -fsS "${H[@]}" "$API/user" | json "d['login']")
echo "  conta: $USUARIO"

echo "› Repositório $USUARIO/$REPO"
if curl -fsS -o /dev/null "${H[@]}" "$API/repos/$USUARIO/$REPO" 2>/dev/null; then
  echo "  já existe — vou só atualizar"
else
  curl -fsS "${H[@]}" -X POST "$API/user/repos" \
    -d "{\"name\":\"$REPO\",\"description\":\"Verifica se a sua rota atravessa áreas que você evita.\",\"private\":false,\"has_wiki\":false,\"has_projects\":false}" >/dev/null
  echo "  criado (público: o GitHub Pages gratuito exige repositório público)"
fi

echo "› Ligando o GitHub Pages (modo Actions)"
curl -sS -o /dev/null "${H[@]}" -X POST "$API/repos/$USUARIO/$REPO/pages" -d '{"build_type":"workflow"}' || true
curl -sS -o /dev/null "${H[@]}" -X PUT "$API/repos/$USUARIO/$REPO/pages" -d '{"build_type":"workflow"}' || true

echo "› Enviando o código"
if [ ! -d .git ]; then git init -q -b main; fi
git add -A
git -c commit.gpgsign=false commit -qm "Contorno: app web instalável" 2>/dev/null || true
git push -q "https://x-access-token:${GITHUB_TOKEN}@github.com/$USUARIO/$REPO.git" HEAD:main --force-with-lease 2>/dev/null \
  || git push -q "https://x-access-token:${GITHUB_TOKEN}@github.com/$USUARIO/$REPO.git" HEAD:main

echo "› Esperando a publicação"
for i in $(seq 1 60); do
  sleep 10
  RUN=$(curl -fsS "${H[@]}" "$API/repos/$USUARIO/$REPO/actions/runs?per_page=1" || echo '{}')
  ST=$(echo "$RUN" | json "(d.get('workflow_runs') or [{}])[0].get('status','?')")
  CO=$(echo "$RUN" | json "(d.get('workflow_runs') or [{}])[0].get('conclusion') or ''")
  printf "  %s %s\r" "$ST" "$CO"
  if [ "$ST" = "completed" ]; then echo; break; fi
done

if [ "${CO:-}" = "success" ]; then
  echo "✓ Publicado: https://$USUARIO.github.io/$REPO/"
else
  echo "✗ A publicação terminou com: ${CO:-desconhecido}. Veja: https://github.com/$USUARIO/$REPO/actions"
  exit 1
fi
