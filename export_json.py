import sqlite3
import json

conn = sqlite3.connect('alojamento.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

# Stats
cur.execute('SELECT count(*) FROM vagas')
tot_vagas = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM vagas WHERE status = 'ocupada'")
tot_ocu = cur.fetchone()[0]
tot_disp = tot_vagas - tot_ocu
taxa = round((tot_ocu / tot_vagas * 100), 1) if tot_vagas else 0

# Blocos
cur.execute('SELECT * FROM blocos ORDER BY ordem')
blocos = [dict(r) for r in cur.fetchall()]

# Empresas
cur.execute('SELECT * FROM empresas ORDER BY nome')
empresas = [dict(r) for r in cur.fetchall()]

# Alojados
cur.execute('''
SELECT 
    a.*, 
    e.nome as empresa_nome, 
    e.cor as empresa_cor,
    b.nome as bloco_nome,
    q.numero as quarto_numero,
    v.numero_cama
FROM alojados a
LEFT JOIN empresas e ON a.empresa_id = e.id
LEFT JOIN vagas v ON a.vaga_id = v.id
LEFT JOIN quartos q ON v.quarto_id = q.id
LEFT JOIN blocos b ON q.bloco_id = b.id
WHERE a.status = 'ativo'
ORDER BY a.nome_completo
''')
alojados = [dict(r) for r in cur.fetchall()]

# Quartos
cur.execute('''
SELECT 
    q.*, 
    b.nome as bloco_nome, 
    b.tipo as bloco_tipo,
    COUNT(v.id) as total_camas,
    SUM(CASE WHEN v.status = 'ocupada' THEN 1 ELSE 0 END) as vagas_ocupadas,
    SUM(CASE WHEN v.status = 'livre' THEN 1 ELSE 0 END) as vagas_livres
FROM quartos q
JOIN blocos b ON q.bloco_id = b.id
LEFT JOIN vagas v ON q.id = v.quarto_id
GROUP BY q.id
ORDER BY b.ordem, CAST(q.numero AS INTEGER), q.numero
''')
quartos = [dict(r) for r in cur.fetchall()]

for q in quartos:
    cur.execute('''
    SELECT v.*, a.id as alojado_id, a.nome_completo, a.matricula, a.funcao, a.foto_url, e.nome as empresa_nome, e.cor as empresa_cor
    FROM vagas v
    LEFT JOIN alojados a ON a.vaga_id = v.id AND a.status = 'ativo'
    LEFT JOIN empresas e ON a.empresa_id = e.id
    WHERE v.quarto_id = ?
    ORDER BY v.numero_cama
    ''', (q['id'],))
    q['vagas'] = [dict(v) for v in cur.fetchall()]
    
    cur.execute('SELECT * FROM moveis_itens WHERE quarto_id = ? ORDER BY tipo_item', (q['id'],))
    q['moveis'] = [dict(m) for m in cur.fetchall()]

data = {
    'geral': {
        'total_vagas': tot_vagas,
        'ocupadas': tot_ocu,
        'disponiveis': tot_disp,
        'taxa_ocupacao': taxa,
        'total_blocos': len(blocos),
        'total_quartos': len(quartos),
        'total_alojados': len(alojados)
    },
    'blocos': blocos,
    'empresas': empresas,
    'alojados': alojados,
    'quartos': quartos
}

with open('dados_iniciais_taboca.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

with open('frontend/dados_iniciais_taboca.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print('Exported dados_iniciais_taboca.json successfully!')
conn.close()
