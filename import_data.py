import openpyxl
import sqlite3
import os
import random
from datetime import datetime, date
from clean_utils import fix_pt_text

EXCEL_FILE = os.path.join(os.path.dirname(__file__), 'ALOJAMENTO TABOCA 2 (1) (4).xlsx')
DB_FILE = os.path.join(os.path.dirname(__file__), 'alojamento.db')

COMPANY_COLORS = {
    'GEL': '#2563eb',             # blue
    'FJ TERRAPLANAGEM': '#d97706', # amber/orange
    'NUTRIVALE': '#16a34a',        # green
    'LUPATINI': '#9333ea',         # purple
    'BRASTRAN': '#0891b2',         # cyan
    'CONSELMAR': '#dc2626',        # red
    'DMT': '#4f46e5',              # indigo
    'CAF': '#059669',              # emerald
    'ALPHASEG': '#475569',         # slate
    'CONCREQUALI': '#ea580c',      # orange
    'BRASILGUINDASTE': '#0284c7',  # sky
    'ESTRELA DE MINAS': '#ca8a04', # yellow
    'CARNEIRO METALURGICA': '#64748b', # gray
}

def normalize_empresa(name):
    if not name:
        return None
    s = str(name).strip().upper()
    if 'FJ' in s and ('TERRA' in s):
        return 'FJ TERRAPLANAGEM'
    if 'CARNEIRO' in s or 'MATARLUGICA' in s or 'METARLUGICA' in s:
        return 'CARNEIRO METALURGICA'
    if 'NUTRIVALE' in s:
        return 'NUTRIVALE'
    if 'CONSELMAR' in s:
        return 'CONSELMAR'
    if 'GEL' in s:
        return 'GEL'
    if 'LUPATINI' in s:
        return 'LUPATINI'
    if 'BRASTRAN' in s:
        return 'BRASTRAN'
    if 'DMT' in s:
        return 'DMT'
    if 'CAF' in s:
        return 'CAF'
    if 'ALPHASEG' in s:
        return 'ALPHASEG'
    if 'CONCREQUALI' in s:
        return 'CONCREQUALI'
    if 'BRASILGUINDASTE' in s or 'GUINDASTE' in s:
        return 'BRASILGUINDASTE'
    if 'ESTRELA' in s:
        return 'ESTRELA DE MINAS'
    return s

def clean(v):
    if v is None:
        return ""
    s = str(v).strip()
    if s.upper() in ['NONE', 'NULL', '#VALUE!', '#REF!', '#N/A']:
        return ""
    return s

def run_import():
    wb = openpyxl.load_workbook(EXCEL_FILE, read_only=True, data_only=True)
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Clean up existing accommodation data if re-importing
    cursor.execute("DELETE FROM auditoria_logs WHERE usuario = 'sistema_importacao'")
    cursor.execute("DELETE FROM moveis_itens")
    cursor.execute("DELETE FROM alojados")
    cursor.execute("DELETE FROM vagas")
    cursor.execute("DELETE FROM quartos")
    cursor.execute("DELETE FROM blocos")
    cursor.execute("DELETE FROM empresas")
    cursor.execute("DELETE FROM funcoes")
    conn.commit()

    sections = [
        ('BLOCOS ALOJAMENTO', 10, 74, 'Bloco 1', 'Bloco 1', 'alojamento', 
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ALOJAMENTO', 84, 148, 'Bloco 2', 'Bloco 2', 'alojamento',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ALOJAMENTO', 159, 223, 'Bloco 3', 'Bloco 3', 'alojamento',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ALOJAMENTO', 242, 306, 'Bloco 4', 'Bloco 4', 'alojamento',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ALOJAMENTO', 317, 381, 'Bloco 5', 'Bloco 5', 'alojamento',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
         
        ('BLOCOS ADM', 10, 42, 'Bloco 1 ADM', 'Bloco 1 ADM', 'adm',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ADM', 57, 77, 'Bloco 2 ADM', 'Bloco 2 ADM', 'adm',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
        ('BLOCOS ADM', 90, 134, 'Bloco 3 ADM', 'Bloco 3 ADM', 'adm',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 14, 'reg': 15, 'nome': 16, 'funcao': 21, 'empresa': 24}),
         
        (wb.sheetnames[3], 9, 41, 'Contêiner 1', 'Contêiner 2', 'conteiner',
         {'quarto': 1, 'reg': 2, 'nome': 3, 'funcao': 8, 'empresa': 11},
         {'quarto': 16, 'reg': 17, 'nome': 18, 'funcao': 23, 'empresa': 26}),
    ]

    # Dicionários de cache
    empresa_cache = {} # nome -> id
    bloco_cache = {}   # (nome, tipo) -> id
    funcao_cache = set()
    
    def get_or_create_empresa(emp_name):
        if not emp_name:
            return None
        emp_name = normalize_empresa(emp_name)
        if emp_name in empresa_cache:
            return empresa_cache[emp_name]
        
        cor = COMPANY_COLORS.get(emp_name, '#64748b')
        cursor.execute("INSERT OR IGNORE INTO empresas (nome, cor) VALUES (?, ?)", (emp_name, cor))
        cursor.execute("SELECT id FROM empresas WHERE nome = ?", (emp_name,))
        row = cursor.fetchone()
        empresa_cache[emp_name] = row['id']
        return row['id']

    def get_or_create_bloco(bname, btype, ordem):
        key = (bname, btype)
        if key in bloco_cache:
            return bloco_cache[key]
        cursor.execute("INSERT OR IGNORE INTO blocos (nome, tipo, ordem) VALUES (?, ?, ?)", (bname, btype, ordem))
        cursor.execute("SELECT id FROM blocos WHERE nome = ?", (bname,))
        row = cursor.fetchone()
        bloco_cache[key] = row['id']
        return row['id']

    def register_funcao(fname):
        if not fname:
            return
        fname = fname.strip().upper()
        if fname not in funcao_cache:
            cursor.execute("INSERT OR IGNORE INTO funcoes (nome) VALUES (?)", (fname,))
            funcao_cache.add(fname)

    ordem_bloco = 1
    total_alojados_importados = 0
    total_vagas_importadas = 0
    total_quartos_importados = 0

    # Estrutura intermediária para ordenar quartos numericamente
    all_rooms_by_block = {} # bloco_id -> { numero_quarto: [beds] }

    for sname, r_start, r_end, b_left, b_right, btype, l_cols, r_cols in sections:
        ws = wb[sname]
        rows = list(ws.iter_rows(values_only=True))
        
        bloco_id_l = get_or_create_bloco(b_left, btype, ordem_bloco)
        if bloco_id_l not in all_rooms_by_block:
            all_rooms_by_block[bloco_id_l] = {}
        
        bloco_id_r = get_or_create_bloco(b_right, btype, ordem_bloco + 1 if b_left != b_right else ordem_bloco)
        if bloco_id_r not in all_rooms_by_block:
            all_rooms_by_block[bloco_id_r] = {}
        
        ordem_bloco += 2
        
        cur_q_l = None
        cur_q_r = None
        
        for r_idx in range(r_start, min(r_end, len(rows))):
            row = rows[r_idx]
            
            # Left side
            ql = clean(row[l_cols['quarto']]) if l_cols['quarto'] < len(row) else ""
            if ql and ql.replace('.', '').isdigit():
                cur_q_l = str(int(float(ql)))
            
            if cur_q_l:
                reg_l = clean(row[l_cols['reg']]) if l_cols['reg'] < len(row) else ""
                nome_l = fix_pt_text(clean(row[l_cols['nome']])) if l_cols['nome'] < len(row) else ""
                funcao_l = fix_pt_text(clean(row[l_cols['funcao']])) if l_cols['funcao'] < len(row) else ""
                emp_l = clean(row[l_cols['empresa']]) if l_cols['empresa'] < len(row) else ""
                
                is_occ = (nome_l != '' and nome_l.upper() != 'VAGA') or (reg_l != '' and reg_l.upper() != 'VAGA' and reg_l.isdigit())
                
                if cur_q_l not in all_rooms_by_block[bloco_id_l]:
                    all_rooms_by_block[bloco_id_l][cur_q_l] = []
                    
                all_rooms_by_block[bloco_id_l][cur_q_l].append({
                    'reg': reg_l if reg_l.upper() != 'VAGA' else '',
                    'nome': nome_l if nome_l.upper() != 'VAGA' else '',
                    'funcao': funcao_l,
                    'empresa': emp_l,
                    'is_occupied': is_occ
                })
                
            # Right side
            if r_cols:
                qr = clean(row[r_cols['quarto']]) if r_cols['quarto'] < len(row) else ""
                if qr and qr.replace('.', '').isdigit():
                    cur_q_r = str(int(float(qr)))
                
                if cur_q_r:
                    reg_r = clean(row[r_cols['reg']]) if r_cols['reg'] < len(row) else ""
                    nome_r = fix_pt_text(clean(row[r_cols['nome']])) if r_cols['nome'] < len(row) else ""
                    funcao_r = fix_pt_text(clean(row[r_cols['funcao']])) if r_cols['funcao'] < len(row) else ""
                    emp_r = clean(row[r_cols['empresa']]) if r_cols['empresa'] < len(row) else ""
                    
                    is_occ = (nome_r != '' and nome_r.upper() != 'VAGA') or (reg_r != '' and reg_r.upper() != 'VAGA' and reg_r.isdigit())
                    
                    if cur_q_r not in all_rooms_by_block[bloco_id_r]:
                        all_rooms_by_block[bloco_id_r][cur_q_r] = []
                        
                    all_rooms_by_block[bloco_id_r][cur_q_r].append({
                        'reg': reg_r if reg_r.upper() != 'VAGA' else '',
                        'nome': nome_r if nome_r.upper() != 'VAGA' else '',
                        'funcao': funcao_r,
                        'empresa': emp_r,
                        'is_occupied': is_occ
                    })

    # Agora inserimos Quartos, Vagas e Alojados no banco de dados
    random.seed(42) # determinístico para vistorias iniciais
    
    for bloco_id, rooms in all_rooms_by_block.items():
        # Ordena quartos numericamente
        sorted_room_keys = sorted(rooms.keys(), key=lambda x: int(x) if x.isdigit() else x)
        
        for q_num in sorted_room_keys:
            beds = rooms[q_num]
            capacidade = max(4, len(beds))
            
            cursor.execute("""
            INSERT INTO quartos (bloco_id, numero, capacidade, observacoes)
            VALUES (?, ?, ?, ?)
            """, (bloco_id, q_num, capacidade, f"Quarto {q_num}"))
            quarto_id = cursor.lastrowid
            total_quartos_importados += 1
            
            # Criar móveis padrão para o quarto
            # Standard items:
            # 2 Beliches (4 camas) ou 4 Camas
            # 4 Colchões
            # 2 Armários / Guarda-roupas
            # 1 Ventilador (ou Ar-condicionado se ADM)
            # 1 Lâmpada
            # 2 Tomadas
            is_adm = (bloco_id in [6, 7, 8]) # ADM blocks
            
            clima_item = 'Ar-Condicionado' if is_adm else 'Ventilador de Parede'
            
            # Introduzir alguns estados variados realistas para o sistema de alertas
            estado_clima = 'Bom'
            manut_clima = 0
            obs_clima = 'Funcionando perfeitamente'
            
            clima_item = 'Ar-Condicionado'
            
            # Quartos específicos com pequenos alertas demonstrativos
            if q_num in ['2', '15', '45', '164', '180']:
                estado_clima = 'Danificado'
                manut_clima = 1
                obs_clima = 'Motor travado / barulho excessivo'
            elif q_num in ['5', '38', '99', '170']:
                estado_clima = 'Regular'
                manut_clima = 1
                obs_clima = 'Filtro sujo necessita limpeza preventiva'
                
            estado_armario = 'Ruim' if q_num in ['12', '70', '162'] else 'Bom'
            manut_armario = 1 if estado_armario == 'Ruim' else 0
            obs_armario = 'Porta solta com dobradiça quebrada' if manut_armario else 'Em bom estado'
            
            data_vistoria = '2026-09-15'
            
            items = [
                ('Beliche / Camas', 2, 'Bom', 0, data_vistoria, 'Estrutura metálica firme'),
                ('Colchão D33', 4, 'Bom', 0, data_vistoria, 'Com capa impermeável'),
                ('Guarda-roupa / Armário', 4, estado_armario, manut_armario, data_vistoria, obs_armario),
                (clima_item, 1, estado_clima, manut_clima, data_vistoria, obs_clima),
                ('Lâmpada LED 12W', 1, 'Bom', 0, data_vistoria, 'Iluminação adequada'),
                ('Tomadas 110V/220V', 2, 'Bom', 0, data_vistoria, 'Testadas e aterradas'),
            ]
            
            for tipo_item, qtd, estado, manut, dt_vist, obs in items:
                cursor.execute("""
                INSERT INTO moveis_itens (quarto_id, tipo_item, quantidade, estado_conservacao, precisa_manutencao, data_vistoria, observacoes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (quarto_id, tipo_item, qtd, estado, manut, dt_vist, obs))
            
            # Criar vagas e alojados
            for idx, bed in enumerate(beds):
                cama_num = idx + 1
                status_vaga = 'ocupada' if bed['is_occupied'] else 'livre'
                
                cursor.execute("""
                INSERT INTO vagas (quarto_id, numero_cama, status)
                VALUES (?, ?, ?)
                """, (quarto_id, cama_num, status_vaga))
                vaga_id = cursor.lastrowid
                total_vagas_importadas += 1
                
                if bed['is_occupied']:
                    emp_id = get_or_create_empresa(bed['empresa'])
                    register_funcao(bed['funcao'])
                    
                    cursor.execute("""
                    INSERT INTO alojados (vaga_id, matricula, nome_completo, empresa_id, funcao, data_entrada, status, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?, 'ativo', ?)
                    """, (vaga_id, bed['reg'], bed['nome'], emp_id, bed['funcao'], '2026-09-01', 'Importado da planilha oficial Taboca 2'))
                    total_alojados_importados += 1

    # Registrar log de auditoria
    cursor.execute("""
    INSERT INTO auditoria_logs (usuario, acao, entidade, entidade_id, detalhes)
    VALUES ('sistema_importacao', 'IMPORTACAO', 'sistema', 1, ?)
    """, (f"Importação completa da planilha Taboca 2: {total_quartos_importados} quartos, {total_vagas_importadas} vagas, {total_alojados_importados} alojados.",))

    conn.commit()
    conn.close()
    
    print("\n================ IMPORTAÇÃO CONCLUÍDA ================")
    print(f"Total de Blocos: {len(all_rooms_by_block)}")
    print(f"Total de Quartos: {total_quartos_importados}")
    print(f"Total de Vagas/Camas: {total_vagas_importadas}")
    print(f"Total de Alojados Ativos: {total_alojados_importados}")
    print(f"Vagas Disponíveis: {total_vagas_importadas - total_alojados_importados}")
    print(f"Empresas cadastradas: {len(empresa_cache)}")
    print("======================================================")

if __name__ == '__main__':
    run_import()
