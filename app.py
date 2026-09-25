import os
import sqlite3
import hashlib
from datetime import datetime, date
from typing import Optional, List
import io
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from fastapi import FastAPI, HTTPException, Depends, Query, UploadFile, File, Form, Request, status
from fastapi.responses import JSONResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.path.join(BASE_DIR, 'alojamento.db')
ORIGINAL_EXCEL = os.path.join(BASE_DIR, 'ALOJAMENTO TABOCA 2 (1) (4).xlsx')
UPLOADS_DIR = os.path.join(BASE_DIR, 'uploads')
FOTOS_DIR = os.path.join(UPLOADS_DIR, 'fotos_alojados')
os.makedirs(FOTOS_DIR, exist_ok=True)

app = FastAPI(title="Prefeitura de Canteiro - Sistema de Controle de Alojamentos", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def log_auditoria(conn, usuario: str, acao: str, entidade: str, entidade_id: Optional[int], detalhes: str):
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO auditoria_logs (usuario, acao, entidade, entidade_id, detalhes)
    VALUES (?, ?, ?, ?, ?)
    """, (usuario or "sistema", acao, entidade, entidade_id, detalhes))

# --- Schemas ---

class LoginRequest(BaseModel):
    username: str
    password: str

class AlojadoCreate(BaseModel):
    vaga_id: int
    matricula: Optional[str] = ""
    nome_completo: str
    empresa_id: Optional[int] = None
    funcao: Optional[str] = ""
    whatsapp: Optional[str] = ""
    data_entrada: Optional[str] = None
    observacoes: Optional[str] = ""
    foto_url: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class AlojadoUpdate(BaseModel):
    matricula: Optional[str] = ""
    nome_completo: str
    empresa_id: Optional[int] = None
    funcao: Optional[str] = ""
    whatsapp: Optional[str] = ""
    data_entrada: Optional[str] = None
    observacoes: Optional[str] = ""
    foto_url: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class RealocarRequest(BaseModel):
    alojado_id: int
    nova_vaga_id: int
    motivo: Optional[str] = "Realocação solicitada pela administração"
    usuario: Optional[str] = "prefeito"

class DesligarRequest(BaseModel):
    alojado_id: int
    data_saida: Optional[str] = None
    motivo: Optional[str] = "Desligamento / Liberação de vaga"
    usuario: Optional[str] = "prefeito"

class ReativarRequest(BaseModel):
    alojado_id: int
    nova_vaga_id: int
    data_entrada: Optional[str] = None
    usuario: Optional[str] = "prefeito"

class MovelCreate(BaseModel):
    quarto_id: int
    tipo_item: str
    quantidade: int = 1
    estado_conservacao: str = "Bom"
    precisa_manutencao: int = 0
    data_vistoria: Optional[str] = None
    observacoes: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class MovelUpdate(BaseModel):
    tipo_item: str
    quantidade: int = 1
    estado_conservacao: str = "Bom"
    precisa_manutencao: int = 0
    data_vistoria: Optional[str] = None
    observacoes: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class BlocoCreate(BaseModel):
    nome: str
    tipo: str # alojamento, adm, conteiner
    ordem: Optional[int] = 0
    usuario: Optional[str] = "prefeito"

class BlocoUpdate(BaseModel):
    nome: str
    tipo: str
    ordem: Optional[int] = 0
    usuario: Optional[str] = "prefeito"

class QuartoCreate(BaseModel):
    bloco_id: int
    numero: str
    capacidade: int = 4
    observacoes: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class QuartoUpdate(BaseModel):
    numero: str
    capacidade: int = 4
    observacoes: Optional[str] = ""
    usuario: Optional[str] = "prefeito"

class EmpresaCreate(BaseModel):
    nome: str
    cor: Optional[str] = "#3b82f6"
    usuario: Optional[str] = "prefeito"

class EmpresaUpdate(BaseModel):
    nome: str
    cor: Optional[str] = "#3b82f6"
    usuario: Optional[str] = "prefeito"

# --- Endpoints de Autenticação ---

@app.post("/api/auth/login")
def login(req: LoginRequest):
    conn = get_db()
    cursor = conn.cursor()
    pwd_hash = hashlib.sha256(req.password.encode('utf-8')).hexdigest()
    cursor.execute("SELECT id, username, nome, perfil FROM usuarios WHERE username = ? AND senha_hash = ?", (req.username, pwd_hash))
    user = cursor.fetchone()
    conn.close()
    if not user:
        raise HTTPException(status_code=401, detail="Usuário ou senha inválidos")
    return {
        "id": user["id"],
        "username": user["username"],
        "nome": user["nome"],
        "perfil": user["perfil"], # 'prefeito' ou 'consulta'
        "token": f"mock-token-{user['username']}"
    }

# --- Dashboard & Estatísticas ---

@app.get("/api/dashboard/stats")
def get_dashboard_stats():
    conn = get_db()
    cursor = conn.cursor()
    
    # Totais gerais
    cursor.execute("SELECT COUNT(*) as total_vagas FROM vagas")
    total_vagas = cursor.fetchone()["total_vagas"]
    
    cursor.execute("SELECT COUNT(*) as ocupadas FROM vagas WHERE status = 'ocupada'")
    ocupadas = cursor.fetchone()["ocupadas"]
    disponiveis = total_vagas - ocupadas
    taxa_ocupacao = round((ocupadas / total_vagas * 100), 1) if total_vagas > 0 else 0
    
    # Totais por Bloco
    cursor.execute("""
    SELECT 
        b.id, b.nome, b.tipo, b.ordem,
        COUNT(DISTINCT q.id) as total_quartos,
        COUNT(v.id) as total_vagas,
        SUM(CASE WHEN v.status = 'ocupada' THEN 1 ELSE 0 END) as ocupadas,
        SUM(CASE WHEN v.status = 'livre' THEN 1 ELSE 0 END) as livres,
        SUM(CASE WHEN m.precisa_manutencao = 1 OR m.estado_conservacao IN ('Ruim', 'Danificado') THEN 1 ELSE 0 END) as itens_alerta
    FROM blocos b
    LEFT JOIN quartos q ON q.bloco_id = b.id
    LEFT JOIN vagas v ON v.quarto_id = q.id
    LEFT JOIN moveis_itens m ON m.quarto_id = q.id
    GROUP BY b.id
    ORDER BY b.ordem ASC, b.id ASC
    """)
    blocos_stats = []
    for row in cursor.fetchall():
        v_tot = row["total_vagas"] or 0
        v_oc = row["ocupadas"] or 0
        v_liv = row["livres"] or 0
        taxa = round((v_oc / v_tot * 100), 1) if v_tot > 0 else 0
        blocos_stats.append({
            "id": row["id"],
            "nome": row["nome"],
            "tipo": row["tipo"],
            "total_quartos": row["total_quartos"],
            "total_vagas": v_tot,
            "ocupadas": v_oc,
            "livres": v_liv,
            "taxa_ocupacao": taxa,
            "itens_alerta": row["itens_alerta"] or 0
        })
        
    # Totais por Empresa
    cursor.execute("""
    SELECT 
        e.id, e.nome, e.cor,
        COUNT(a.id) as total_alojados
    FROM empresas e
    LEFT JOIN alojados a ON a.empresa_id = e.id AND a.status = 'ativo'
    GROUP BY e.id
    HAVING total_alojados > 0
    ORDER BY total_alojados DESC
    """)
    empresas_stats = [dict(r) for r in cursor.fetchall()]
    
    # Alertas de móveis/itens em estado Ruim/Danificado
    cursor.execute("""
    SELECT 
        m.id, m.tipo_item, m.quantidade, m.estado_conservacao, m.precisa_manutencao, m.data_vistoria, m.observacoes,
        q.id as quarto_id, q.numero as quarto_numero,
        b.id as bloco_id, b.nome as bloco_nome
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE m.estado_conservacao IN ('Ruim', 'Danificado') OR m.precisa_manutencao = 1
    ORDER BY b.ordem ASC, q.numero ASC
    """)
    alertas_moveis = [dict(r) for r in cursor.fetchall()]
    
    # Contagem de tipos de blocos
    cursor.execute("SELECT COUNT(DISTINCT id) as total_blocos FROM blocos")
    total_blocos = cursor.fetchone()["total_blocos"]
    
    cursor.execute("SELECT COUNT(DISTINCT id) as total_quartos FROM quartos")
    total_quartos = cursor.fetchone()["total_quartos"]
    
    cursor.execute("SELECT COUNT(*) as total_desligados FROM alojados WHERE status = 'desligado'")
    total_desligados = cursor.fetchone()["total_desligados"]

    conn.close()
    return {
        "geral": {
            "total_vagas": total_vagas,
            "ocupadas": ocupadas,
            "disponiveis": disponiveis,
            "taxa_ocupacao": taxa_ocupacao,
            "total_blocos": total_blocos,
            "total_quartos": total_quartos,
            "total_alojados_ativos": ocupadas,
            "total_desligados": total_desligados,
            "total_alertas_manutencao": len(alertas_moveis)
        },
        "blocos": blocos_stats,
        "empresas": empresas_stats,
        "alertas_moveis": alertas_moveis
    }

# --- Blocos ---

@app.get("/api/blocos")
def get_blocos():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        b.id, b.nome, b.tipo, b.ordem,
        COUNT(DISTINCT q.id) as total_quartos,
        COUNT(v.id) as total_vagas,
        SUM(CASE WHEN v.status = 'ocupada' THEN 1 ELSE 0 END) as ocupadas,
        SUM(CASE WHEN v.status = 'livre' THEN 1 ELSE 0 END) as livres
    FROM blocos b
    LEFT JOIN quartos q ON q.bloco_id = b.id
    LEFT JOIN vagas v ON v.quarto_id = q.id
    GROUP BY b.id
    ORDER BY b.ordem ASC, b.id ASC
    """)
    blocos = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return blocos

@app.post("/api/blocos")
def create_bloco(req: BlocoCreate):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO blocos (nome, tipo, ordem) VALUES (?, ?, ?)", (req.nome.strip(), req.tipo, req.ordem or 0))
        bloco_id = cursor.lastrowid
        log_auditoria(conn, req.usuario, "CRIAR", "bloco", bloco_id, f"Bloco '{req.nome}' criado com tipo '{req.tipo}'")
        conn.commit()
        conn.close()
        return {"id": bloco_id, "message": "Bloco criado com sucesso"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Já existe um bloco com esse nome")

@app.put("/api/blocos/{bloco_id}")
def update_bloco(bloco_id: int, req: BlocoUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT nome FROM blocos WHERE id = ?", (bloco_id,))
    bloco = cursor.fetchone()
    if not bloco:
        conn.close()
        raise HTTPException(status_code=404, detail="Bloco não encontrado")
    cursor.execute("UPDATE blocos SET nome = ?, tipo = ?, ordem = ? WHERE id = ?", (req.nome.strip(), req.tipo, req.ordem or 0, bloco_id))
    log_auditoria(conn, req.usuario, "EDITAR", "bloco", bloco_id, f"Bloco alterado para '{req.nome}' ({req.tipo})")
    conn.commit()
    conn.close()
    return {"message": "Bloco atualizado com sucesso"}

@app.delete("/api/blocos/{bloco_id}")
def delete_bloco(bloco_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT nome FROM blocos WHERE id = ?", (bloco_id,))
    bloco = cursor.fetchone()
    if not bloco:
        conn.close()
        raise HTTPException(status_code=404, detail="Bloco não encontrado")
    # Verificar se há vagas ocupadas
    cursor.execute("""
    SELECT COUNT(*) as ocupadas FROM vagas v
    JOIN quartos q ON v.quarto_id = q.id
    WHERE q.bloco_id = ? AND v.status = 'ocupada'
    """, (bloco_id,))
    if cursor.fetchone()["ocupadas"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Não é possível excluir bloco com vagas ocupadas. Libere ou realoque os alojados primeiro.")
    
    cursor.execute("DELETE FROM blocos WHERE id = ?", (bloco_id,))
    log_auditoria(conn, usuario, "EXCLUIR", "bloco", bloco_id, f"Bloco '{bloco['nome']}' excluído")
    conn.commit()
    conn.close()
    return {"message": "Bloco excluído com sucesso"}

# --- Quartos & Mapa de Camas ---

@app.get("/api/quartos")
def get_quartos(
    bloco_id: Optional[int] = Query(None),
    status_ocupacao: Optional[str] = Query(None), # 'com_vagas', 'quase_cheio', 'lotado', 'vazio'
    filtro_alerta: Optional[bool] = Query(None),
    q: Optional[str] = Query(None)
):
    conn = get_db()
    cursor = conn.cursor()
    
    query = """
    SELECT 
        q.id, q.bloco_id, q.numero, q.capacidade, q.observacoes,
        b.nome as bloco_nome, b.tipo as bloco_tipo,
        COUNT(v.id) as total_vagas,
        SUM(CASE WHEN v.status = 'ocupada' THEN 1 ELSE 0 END) as vagas_ocupadas,
        SUM(CASE WHEN v.status = 'livre' THEN 1 ELSE 0 END) as vagas_livres,
        SUM(CASE WHEN m.precisa_manutencao = 1 OR m.estado_conservacao IN ('Ruim', 'Danificado') THEN 1 ELSE 0 END) as itens_alerta
    FROM quartos q
    JOIN blocos b ON q.bloco_id = b.id
    LEFT JOIN vagas v ON v.quarto_id = q.id
    LEFT JOIN moveis_itens m ON m.quarto_id = q.id
    WHERE 1=1
    """
    params = []
    if bloco_id:
        query += " AND q.bloco_id = ?"
        params.append(bloco_id)
    if q:
        query += " AND (q.numero LIKE ? OR b.nome LIKE ?)"
        params.extend([f"%{q}%", f"%{q}%"])
        
    query += " GROUP BY q.id ORDER BY b.ordem ASC, CAST(q.numero AS INTEGER) ASC, q.numero ASC"
    
    cursor.execute(query, params)
    quartos_raw = cursor.fetchall()
    
    # Buscar todas as vagas com os respectivos alojados
    cursor.execute("""
    SELECT 
        v.id as vaga_id, v.quarto_id, v.numero_cama, v.status,
        a.id as alojado_id, a.matricula, a.nome_completo, a.funcao, a.data_entrada, a.foto_url,
        e.id as empresa_id, e.nome as empresa_nome, e.cor as empresa_cor
    FROM vagas v
    LEFT JOIN alojados a ON a.vaga_id = v.id AND a.status = 'ativo'
    LEFT JOIN empresas e ON a.empresa_id = e.id
    ORDER BY v.quarto_id, v.numero_cama
    """)
    vagas_por_quarto = {}
    for r in cursor.fetchall():
        qid = r["quarto_id"]
        if qid not in vagas_por_quarto:
            vagas_por_quarto[qid] = []
        vagas_por_quarto[qid].append(dict(r))
        
    resultado = []
    for r in quartos_raw:
        item = dict(r)
        qid = item["id"]
        vagas = vagas_por_quarto.get(qid, [])
        item["vagas"] = vagas
        
        tot = item["total_vagas"] or 0
        oc = item["vagas_ocupadas"] or 0
        
        # Determinar status visual
        if oc == 0:
            status_calc = 'vazio'
            cor_status = 'green'
        elif oc >= tot:
            status_calc = 'lotado'
            cor_status = 'red'
        elif oc == tot - 1:
            status_calc = 'quase_cheio'
            cor_status = 'yellow'
        else:
            status_calc = 'com_vagas'
            cor_status = 'green'
            
        item["status_visual"] = status_calc
        item["cor_status"] = cor_status
        
        if status_ocupacao:
            if status_ocupacao == 'com_vagas' and item["vagas_livres"] == 0:
                continue
            elif status_ocupacao == 'lotado' and status_calc != 'lotado':
                continue
            elif status_ocupacao == 'quase_cheio' and status_calc != 'quase_cheio':
                continue
            elif status_ocupacao == 'vazio' and status_calc != 'vazio':
                continue
                
        if filtro_alerta and item["itens_alerta"] == 0:
            continue
            
        resultado.append(item)
        
    conn.close()
    return resultado

@app.get("/api/quartos/{quarto_id}")
def get_quarto_detalhes(quarto_id: int):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        q.id, q.bloco_id, q.numero, q.capacidade, q.observacoes,
        b.nome as bloco_nome, b.tipo as bloco_tipo
    FROM quartos q
    JOIN blocos b ON q.bloco_id = b.id
    WHERE q.id = ?
    """, (quarto_id,))
    quarto = cursor.fetchone()
    if not quarto:
        conn.close()
        raise HTTPException(status_code=404, detail="Quarto não encontrado")
    
    quarto_dict = dict(quarto)
    
    # Camas / Vagas
    cursor.execute("""
    SELECT 
        v.id as vaga_id, v.quarto_id, v.numero_cama, v.status,
        a.id as alojado_id, a.matricula, a.nome_completo, a.funcao, a.whatsapp, a.data_entrada, a.foto_url, a.observacoes as alojado_obs,
        e.id as empresa_id, e.nome as empresa_nome, e.cor as empresa_cor
    FROM vagas v
    LEFT JOIN alojados a ON a.vaga_id = v.id AND a.status = 'ativo'
    LEFT JOIN empresas e ON a.empresa_id = e.id
    WHERE v.quarto_id = ?
    ORDER BY v.numero_cama ASC
    """, (quarto_id,))
    quarto_dict["vagas"] = [dict(r) for r in cursor.fetchall()]
    
    # Móveis / Itens
    cursor.execute("""
    SELECT id, tipo_item, quantidade, estado_conservacao, precisa_manutencao, data_vistoria, observacoes, foto_url
    FROM moveis_itens
    WHERE quarto_id = ?
    ORDER BY id ASC
    """, (quarto_id,))
    quarto_dict["moveis"] = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    return quarto_dict

@app.post("/api/quartos")
def create_quarto(req: QuartoCreate):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("""
        INSERT INTO quartos (bloco_id, numero, capacidade, observacoes)
        VALUES (?, ?, ?, ?)
        """, (req.bloco_id, req.numero.strip(), req.capacidade, req.observacoes or ""))
        quarto_id = cursor.lastrowid
        
        # Gerar camas / vagas automaticamente
        for c in range(1, req.capacidade + 1):
            cursor.execute("INSERT INTO vagas (quarto_id, numero_cama, status) VALUES (?, ?, 'livre')", (quarto_id, c))
            
        # Adicionar itens padrão do quarto (2 Beliches, 4 Armários, 1 Ar-Condicionado conforme regra de obra)
        itens_padrao = [
            ('Beliche / Cama', 2, 'Bom', 0),
            ('Colchão D33', req.capacidade if req.capacidade >= 4 else 4, 'Bom', 0),
            ('Armário / Guarda-roupa', 4, 'Bom', 0),
            ('Ar-Condicionado', 1, 'Bom', 0),
            ('Lâmpada LED', 1, 'Bom', 0),
            ('Tomadas', 2, 'Bom', 0),
            ('Fechadura', 1, 'Bom', 0)
        ]
        hoje = date.today().isoformat()
        for item, qtd, estado, manut in itens_padrao:
            cursor.execute("""
            INSERT INTO moveis_itens (quarto_id, tipo_item, quantidade, estado_conservacao, precisa_manutencao, data_vistoria)
            VALUES (?, ?, ?, ?, ?, ?)
            """, (quarto_id, item, qtd, estado, manut, hoje))
            
        cursor.execute("SELECT nome FROM blocos WHERE id = ?", (req.bloco_id,))
        bloco_nome = cursor.fetchone()["nome"]
        log_auditoria(conn, req.usuario, "CRIAR", "quarto", quarto_id, f"Quarto {req.numero} criado no {bloco_nome} com capacidade de {req.capacidade} vagas")
        conn.commit()
        conn.close()
        return {"id": quarto_id, "message": "Quarto criado com sucesso"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Já existe um quarto com este número neste bloco")

@app.put("/api/quartos/{quarto_id}")
def update_quarto(quarto_id: int, req: QuartoUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT bloco_id, numero, capacidade FROM quartos WHERE id = ?", (quarto_id,))
    q_antigo = cursor.fetchone()
    if not q_antigo:
        conn.close()
        raise HTTPException(status_code=404, detail="Quarto não encontrado")
        
    cursor.execute("""
    UPDATE quartos SET numero = ?, capacidade = ?, observacoes = ? WHERE id = ?
    """, (req.numero.strip(), req.capacidade, req.observacoes or "", quarto_id))
    
    # Se a capacidade aumentou, criar novas vagas
    cursor.execute("SELECT COUNT(*) as total_vagas FROM vagas WHERE quarto_id = ?", (quarto_id,))
    qtd_atual = cursor.fetchone()["total_vagas"]
    if req.capacidade > qtd_atual:
        for c in range(qtd_atual + 1, req.capacidade + 1):
            cursor.execute("INSERT INTO vagas (quarto_id, numero_cama, status) VALUES (?, ?, 'livre')", (quarto_id, c))
            
    log_auditoria(conn, req.usuario, "EDITAR", "quarto", quarto_id, f"Quarto {req.numero} atualizado (capacidade: {req.capacidade})")
    conn.commit()
    conn.close()
    return {"message": "Quarto atualizado com sucesso"}

@app.delete("/api/quartos/{quarto_id}")
def delete_quarto(quarto_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT q.numero, b.nome as bloco_nome FROM quartos q JOIN blocos b ON q.bloco_id = b.id WHERE q.id = ?", (quarto_id,))
    quarto = cursor.fetchone()
    if not quarto:
        conn.close()
        raise HTTPException(status_code=404, detail="Quarto não encontrado")
        
    cursor.execute("SELECT COUNT(*) as ocupadas FROM vagas WHERE quarto_id = ? AND status = 'ocupada'", (quarto_id,))
    if cursor.fetchone()["ocupadas"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Não é possível excluir quarto com vagas ocupadas. Libere os alojados primeiro.")
        
    cursor.execute("DELETE FROM quartos WHERE id = ?", (quarto_id,))
    log_auditoria(conn, usuario, "EXCLUIR", "quarto", quarto_id, f"Quarto {quarto['numero']} do {quarto['bloco_nome']} excluído")
    conn.commit()
    conn.close()
    return {"message": "Quarto excluído com sucesso"}

# --- Alojados ---

@app.get("/api/alojados")
def get_alojados(
    status_alojado: Optional[str] = Query("ativo"), # 'ativo', 'desligado', 'todos'
    bloco_id: Optional[int] = Query(None),
    empresa_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=1000)
):
    conn = get_db()
    cursor = conn.cursor()
    
    query = """
    SELECT 
        a.id, a.matricula, a.nome_completo, a.funcao, a.whatsapp, a.data_entrada, a.data_saida, a.status, a.observacoes, a.foto_url,
        e.id as empresa_id, e.nome as empresa_nome, e.cor as empresa_cor,
        v.id as vaga_id, v.numero_cama,
        q.id as quarto_id, q.numero as quarto_numero,
        b.id as bloco_id, b.nome as bloco_nome
    FROM alojados a
    LEFT JOIN empresas e ON a.empresa_id = e.id
    LEFT JOIN vagas v ON a.vaga_id = v.id
    LEFT JOIN quartos q ON v.quarto_id = q.id
    LEFT JOIN blocos b ON q.bloco_id = b.id
    WHERE 1=1
    """
    params = []
    if status_alojado and status_alojado != 'todos':
        query += " AND a.status = ?"
        params.append(status_alojado)
    if bloco_id:
        query += " AND b.id = ?"
        params.append(bloco_id)
    if empresa_id:
        query += " AND a.empresa_id = ?"
        params.append(empresa_id)
    if q:
        query += " AND (a.nome_completo LIKE ? OR a.matricula LIKE ? OR a.funcao LIKE ? OR q.numero LIKE ? OR e.nome LIKE ?)"
        term = f"%{q}%"
        params.extend([term, term, term, term, term])
        
    # Count total
    count_query = f"SELECT COUNT(*) as total FROM ({query})"
    cursor.execute(count_query, params)
    total = cursor.fetchone()["total"]
    
    query += " ORDER BY a.status ASC, a.nome_completo ASC LIMIT ? OFFSET ?"
    offset = (page - 1) * limit
    params.extend([limit, offset])
    
    cursor.execute(query, params)
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    
    return {
        "total": total,
        "page": page,
        "limit": limit,
        "items": rows
    }

@app.post("/api/alojados")
def create_alojado(req: AlojadoCreate):
    conn = get_db()
    cursor = conn.cursor()
    
    # Verificar vaga
    cursor.execute("""
    SELECT v.id, v.quarto_id, v.numero_cama, v.status, q.numero as quarto_numero, b.nome as bloco_nome
    FROM vagas v
    JOIN quartos q ON v.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE v.id = ?
    """, (req.vaga_id,))
    vaga = cursor.fetchone()
    if not vaga:
        conn.close()
        raise HTTPException(status_code=404, detail="Vaga não encontrada")
    if vaga["status"] == "ocupada":
        conn.close()
        raise HTTPException(status_code=400, detail="Esta vaga já está ocupada por outro alojado")
        
    emp_id = None
    if req.empresa_id and req.empresa_id > 0:
        cursor.execute("SELECT id FROM empresas WHERE id = ?", (req.empresa_id,))
        if cursor.fetchone():
            emp_id = req.empresa_id

    dt_entrada = req.data_entrada or date.today().isoformat()
    try:
        cursor.execute("""
        INSERT INTO alojados (vaga_id, matricula, nome_completo, empresa_id, funcao, whatsapp, data_entrada, status, observacoes, foto_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'ativo', ?, ?)
        """, (req.vaga_id, req.matricula.strip() if req.matricula else "", req.nome_completo.strip().upper(), emp_id, req.funcao.strip().upper() if req.funcao else "", req.whatsapp.strip() if req.whatsapp else "", dt_entrada, req.observacoes or "", req.foto_url or ""))
        alojado_id = cursor.lastrowid
        
        # Marcar vaga como ocupada
        cursor.execute("UPDATE vagas SET status = 'ocupada' WHERE id = ?", (req.vaga_id,))
        
        log_auditoria(conn, req.usuario, "CRIAR", "alojado", alojado_id, f"Alojado '{req.nome_completo.upper()}' alocado na Cama {vaga['numero_cama']} do Quarto {vaga['quarto_numero']} ({vaga['bloco_nome']})")
        conn.commit()
        conn.close()
        return {"id": alojado_id, "message": "Alojado cadastrado e alocado com sucesso"}
    except Exception as e:
        conn.rollback()
        conn.close()
        raise HTTPException(status_code=400, detail=f"Erro ao salvar alojado: {str(e)}")

@app.put("/api/alojados/{alojado_id}")
def update_alojado(alojado_id: int, req: AlojadoUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT nome_completo FROM alojados WHERE id = ?", (alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    emp_id = None
    if req.empresa_id and req.empresa_id > 0:
        cursor.execute("SELECT id FROM empresas WHERE id = ?", (req.empresa_id,))
        if cursor.fetchone():
            emp_id = req.empresa_id
            
    cursor.execute("""
    UPDATE alojados 
    SET matricula = ?, nome_completo = ?, empresa_id = ?, funcao = ?, whatsapp = ?, data_entrada = ?, observacoes = ?, foto_url = COALESCE(NULLIF(?, ''), foto_url)
    WHERE id = ?
    """, (req.matricula.strip() if req.matricula else "", req.nome_completo.strip().upper(), emp_id, req.funcao.strip().upper() if req.funcao else "", req.whatsapp.strip() if req.whatsapp else "", req.data_entrada, req.observacoes or "", req.foto_url or "", alojado_id))
    
    log_auditoria(conn, req.usuario, "EDITAR", "alojado", alojado_id, f"Dados do alojado '{req.nome_completo.upper()}' atualizados")
    conn.commit()
    conn.close()
    return {"message": "Alojado atualizado com sucesso"}

IMGBB_API_KEY = "655783f08b2e45a3cd6b1b7a7e6ce91b"

def upload_to_imgbb(image_bytes: bytes, filename: str) -> Optional[str]:
    """Envia cópia da foto para a nuvem gratuita do ImgBB"""
    try:
        import requests
        url = "https://api.imgbb.com/1/upload"
        files = {"image": (filename, image_bytes, "image/jpeg")}
        data = {"key": IMGBB_API_KEY}
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = requests.post(url, data=data, files=files, headers=headers, timeout=12)
        if res.status_code == 200:
            res_json = res.json()
            return res_json.get("data", {}).get("display_url") or res_json.get("data", {}).get("url")
    except Exception as e:
        print(f"Aviso ImgBB: {e}. Mantendo armazenamento local.")
    return None

@app.post("/api/alojados/{alojado_id}/foto")
async def upload_foto_alojado(alojado_id: int, file: UploadFile = File(...), usuario: str = Form("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nome_completo, foto_url FROM alojados WHERE id = ?", (alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    ext = os.path.splitext(file.filename)[1].lower() or ".jpg"
    if ext not in [".jpg", ".jpeg", ".png", ".webp", ".gif"]:
        ext = ".jpg"
        
    import uuid
    filename = f"alojado_{alojado_id}_{uuid.uuid4().hex[:8]}{ext}"
    filepath = os.path.join(FOTOS_DIR, filename)
    
    content = await file.read()
    with open(filepath, "wb") as f:
        f.write(content)
        
    rel_url = f"/uploads/fotos_alojados/{filename}"
    
    # Enviar para ImgBB na nuvem mantendo cópia no PC local
    imgbb_url = upload_to_imgbb(content, filename)
    final_url = imgbb_url if imgbb_url else rel_url
    
    cursor.execute("UPDATE alojados SET foto_url = ? WHERE id = ?", (final_url, alojado_id))
    log_auditoria(conn, usuario, "EDITAR", "alojado", alojado_id, f"Foto atualizada para o colaborador '{alojado['nome_completo']}' (Salvo no PC e ImgBB)")
    conn.commit()
    conn.close()
    return {
        "message": "Foto enviada com sucesso!", 
        "foto_url": final_url,
        "local_url": rel_url,
        "imgbb_url": imgbb_url
    }

@app.delete("/api/alojados/{alojado_id}/foto")
def remover_foto_alojado(alojado_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nome_completo, foto_url FROM alojados WHERE id = ?", (alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    if alojado["foto_url"]:
        try:
            rel = alojado["foto_url"].replace("/uploads/fotos_alojados/", "")
            full_p = os.path.join(FOTOS_DIR, rel)
            if os.path.exists(full_p):
                os.remove(full_p)
        except Exception:
            pass
            
    cursor.execute("UPDATE alojados SET foto_url = NULL WHERE id = ?", (alojado_id,))
    log_auditoria(conn, usuario, "EDITAR", "alojado", alojado_id, f"Foto removida do colaborador '{alojado['nome_completo']}'")
    conn.commit()
    conn.close()
    return {"message": "Foto removida com sucesso!"}

@app.post("/api/alojados/realocar")
def realocar_alojado(req: RealocarRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT a.id, a.nome_completo, a.vaga_id, v.numero_cama as cama_antiga, q.numero as quarto_antigo, b.nome as bloco_antigo
    FROM alojados a
    LEFT JOIN vagas v ON a.vaga_id = v.id
    LEFT JOIN quartos q ON v.quarto_id = q.id
    LEFT JOIN blocos b ON q.bloco_id = b.id
    WHERE a.id = ?
    """, (req.alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    vaga_antiga_id = alojado["vaga_id"]
    
    # Verificar nova vaga
    cursor.execute("""
    SELECT v.id, v.quarto_id, v.numero_cama as cama_nova, v.status, q.numero as quarto_novo, b.nome as bloco_novo
    FROM vagas v
    JOIN quartos q ON v.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE v.id = ?
    """, (req.nova_vaga_id,))
    nova_vaga = cursor.fetchone()
    if not nova_vaga:
        conn.close()
        raise HTTPException(status_code=404, detail="Vaga destino não encontrada")
    if nova_vaga["status"] == "ocupada":
        conn.close()
        raise HTTPException(status_code=400, detail="A vaga destino já está ocupada")
        
    # Liberar vaga antiga se houver
    if vaga_antiga_id:
        cursor.execute("UPDATE vagas SET status = 'livre' WHERE id = ?", (vaga_antiga_id,))
        
    # Ocupar nova vaga
    cursor.execute("UPDATE vagas SET status = 'ocupada' WHERE id = ?", (req.nova_vaga_id,))
    
    # Atualizar alojado
    cursor.execute("UPDATE alojados SET vaga_id = ?, status = 'ativo' WHERE id = ?", (req.nova_vaga_id, req.alojado_id))
    
    detalhe = f"Realocação de '{alojado['nome_completo']}': De [{alojado['bloco_antigo']} Quarto {alojado['quarto_antigo']} Cama {alojado['cama_antiga']}] para [{nova_vaga['bloco_novo']} Quarto {nova_vaga['quarto_novo']} Cama {nova_vaga['cama_nova']}]. Motivo: {req.motivo}"
    log_auditoria(conn, req.usuario, "REALOCAR", "alojado", req.alojado_id, detalhe)
    
    conn.commit()
    conn.close()
    return {"message": "Alojado realocado com sucesso"}

@app.post("/api/alojados/desligar")
def desligar_alojado(req: DesligarRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    SELECT a.id, a.nome_completo, a.vaga_id, v.numero_cama, q.numero as quarto_num, b.nome as bloco_nome
    FROM alojados a
    LEFT JOIN vagas v ON a.vaga_id = v.id
    LEFT JOIN quartos q ON v.quarto_id = q.id
    LEFT JOIN blocos b ON q.bloco_id = b.id
    WHERE a.id = ?
    """, (req.alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    vaga_id = alojado["vaga_id"]
    dt_saida = req.data_saida or date.today().isoformat()
    
    # Atualizar alojado: status 'desligado', desassocia vaga_id (ou mantém vaga_id como histórico e apenas desocupa a vaga)
    cursor.execute("""
    UPDATE alojados 
    SET status = 'desligado', data_saida = ?, vaga_id = NULL, observacoes = COALESCE(observacoes, '') || ' [Desligamento: ' || ? || ']'
    WHERE id = ?
    """, (dt_saida, req.motivo or "Saída registrada", req.alojado_id))
    
    # Liberar a vaga
    if vaga_id:
        cursor.execute("UPDATE vagas SET status = 'livre' WHERE id = ?", (vaga_id,))
        
    detalhe = f"Saída/Desligamento de '{alojado['nome_completo']}'. Vaga liberada: {alojado['bloco_nome']} Quarto {alojado['quarto_num']} Cama {alojado['numero_cama']}. Motivo: {req.motivo}"
    log_auditoria(conn, req.usuario, "DESLIGAR", "alojado", req.alojado_id, detalhe)
    
    conn.commit()
    conn.close()
    return {"message": "Saída registrada e vaga liberada com sucesso"}

@app.post("/api/alojados/reativar")
def reativar_alojado(req: ReativarRequest):
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, nome_completo FROM alojados WHERE id = ?", (req.alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    # Verificar vaga
    cursor.execute("""
    SELECT v.id, v.quarto_id, v.numero_cama, v.status, q.numero as quarto_numero, b.nome as bloco_nome
    FROM vagas v
    JOIN quartos q ON v.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE v.id = ?
    """, (req.nova_vaga_id,))
    vaga = cursor.fetchone()
    if not vaga:
        conn.close()
        raise HTTPException(status_code=404, detail="Vaga destino não encontrada")
    if vaga["status"] == "ocupada":
        conn.close()
        raise HTTPException(status_code=400, detail="Vaga destino já está ocupada")
        
    dt_entrada = req.data_entrada or date.today().isoformat()
    cursor.execute("""
    UPDATE alojados 
    SET vaga_id = ?, status = 'ativo', data_entrada = ?, data_saida = NULL
    WHERE id = ?
    """, (req.nova_vaga_id, dt_entrada, req.alojado_id))
    
    cursor.execute("UPDATE vagas SET status = 'ocupada' WHERE id = ?", (req.nova_vaga_id,))
    
    log_auditoria(conn, req.usuario, "REATIVAR", "alojado", req.alojado_id, f"Alojado '{alojado['nome_completo']}' reativado na Cama {vaga['numero_cama']} do Quarto {vaga['quarto_numero']} ({vaga['bloco_nome']})")
    conn.commit()
    conn.close()
    return {"message": "Alojado reativado com sucesso"}

@app.delete("/api/alojados/{alojado_id}")
def delete_alojado(alojado_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, nome_completo, vaga_id FROM alojados WHERE id = ?", (alojado_id,))
    alojado = cursor.fetchone()
    if not alojado:
        conn.close()
        raise HTTPException(status_code=404, detail="Alojado não encontrado")
        
    if alojado["vaga_id"]:
        cursor.execute("UPDATE vagas SET status = 'livre' WHERE id = ?", (alojado["vaga_id"],))
        
    cursor.execute("DELETE FROM alojados WHERE id = ?", (alojado_id,))
    log_auditoria(conn, usuario, "EXCLUIR", "alojado", alojado_id, f"Cadastro do alojado '{alojado['nome_completo']}' removido")
    conn.commit()
    conn.close()
    return {"message": "Alojado removido com sucesso"}

# --- Vagas Livres (para formulários) ---

@app.get("/api/vagas/livres")
def get_vagas_livres():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        v.id as vaga_id, v.numero_cama,
        q.id as quarto_id, q.numero as quarto_numero,
        b.id as bloco_id, b.nome as bloco_nome, b.tipo as bloco_tipo
    FROM vagas v
    JOIN quartos q ON v.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE v.status = 'livre'
    ORDER BY b.ordem ASC, CAST(q.numero AS INTEGER) ASC, q.numero ASC, v.numero_cama ASC
    """)
    vagas = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return vagas

# --- Móveis & Itens dos Quartos ---

@app.get("/api/moveis")
def get_moveis(
    bloco_id: Optional[int] = Query(None),
    quarto_id: Optional[int] = Query(None),
    estado: Optional[str] = Query(None),
    precisa_manutencao: Optional[int] = Query(None),
    q: Optional[str] = Query(None)
):
    conn = get_db()
    cursor = conn.cursor()
    query = """
    SELECT 
        m.id, m.quarto_id, m.tipo_item, m.quantidade, m.estado_conservacao, m.precisa_manutencao, m.data_vistoria, m.observacoes, m.foto_url,
        q.numero as quarto_numero,
        b.id as bloco_id, b.nome as bloco_nome
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE 1=1
    """
    params = []
    if bloco_id:
        query += " AND b.id = ?"
        params.append(bloco_id)
    if quarto_id:
        query += " AND q.id = ?"
        params.append(quarto_id)
    if estado:
        query += " AND m.estado_conservacao = ?"
        params.append(estado)
    if precisa_manutencao is not None:
        query += " AND m.precisa_manutencao = ?"
        params.append(precisa_manutencao)
    if q:
        query += " AND (m.tipo_item LIKE ? OR q.numero LIKE ? OR m.observacoes LIKE ?)"
        term = f"%{q}%"
        params.extend([term, term, term])
        
    query += " ORDER BY b.ordem ASC, CAST(q.numero AS INTEGER) ASC, m.precisa_manutencao DESC, m.id ASC"
    cursor.execute(query, params)
    itens = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return itens

@app.post("/api/moveis")
def create_movel(req: MovelCreate):
    conn = get_db()
    cursor = conn.cursor()
    dt_vist = req.data_vistoria or date.today().isoformat()
    cursor.execute("""
    INSERT INTO moveis_itens (quarto_id, tipo_item, quantidade, estado_conservacao, precisa_manutencao, data_vistoria, observacoes)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    """, (req.quarto_id, req.tipo_item.strip(), req.quantidade, req.estado_conservacao, req.precisa_manutencao, dt_vist, req.observacoes or ""))
    movel_id = cursor.lastrowid
    
    cursor.execute("SELECT q.numero, b.nome as bloco_nome FROM quartos q JOIN blocos b ON q.bloco_id = b.id WHERE q.id = ?", (req.quarto_id,))
    info = cursor.fetchone()
    log_auditoria(conn, req.usuario, "CRIAR", "movel", movel_id, f"Item '{req.tipo_item}' (qtd: {req.quantidade}, estado: {req.estado_conservacao}) adicionado ao Quarto {info['numero']} ({info['bloco_nome']})")
    conn.commit()
    conn.close()
    return {"id": movel_id, "message": "Item cadastrado com sucesso"}

@app.put("/api/moveis/{movel_id}")
def update_movel(movel_id: int, req: MovelUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT m.id, m.tipo_item, q.numero as quarto_num, b.nome as bloco_nome
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE m.id = ?
    """, (movel_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item não encontrado")
        
    dt_vist = req.data_vistoria or date.today().isoformat()
    cursor.execute("""
    UPDATE moveis_itens 
    SET tipo_item = ?, quantidade = ?, estado_conservacao = ?, precisa_manutencao = ?, data_vistoria = ?, observacoes = ?
    WHERE id = ?
    """, (req.tipo_item.strip(), req.quantidade, req.estado_conservacao, req.precisa_manutencao, dt_vist, req.observacoes or "", movel_id))
    
    log_auditoria(conn, req.usuario, "EDITAR", "movel", movel_id, f"Item '{req.tipo_item}' do Quarto {item['quarto_num']} atualizado (estado: {req.estado_conservacao}, manutenção: {req.precisa_manutencao})")
    conn.commit()
    conn.close()
    return {"message": "Item atualizado com sucesso"}

@app.post("/api/moveis/{movel_id}/resolver-manutencao")
def resolver_manutencao_movel(movel_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT m.tipo_item, q.numero as quarto_num, b.nome as bloco_nome
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE m.id = ?
    """, (movel_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item não encontrado")
        
    hoje = date.today().isoformat()
    cursor.execute("""
    UPDATE moveis_itens 
    SET estado_conservacao = 'Bom', precisa_manutencao = 0, data_vistoria = ?, observacoes = COALESCE(observacoes, '') || ' [Manutenção realizada em ' || ? || ' por ' || ? || ']'
    WHERE id = ?
    """, (hoje, hoje, usuario, movel_id))
    
    log_auditoria(conn, usuario, "RESOLVER_MANUTENCAO", "movel", movel_id, f"Manutenção resolvida no item '{item['tipo_item']}' do Quarto {item['quarto_num']} ({item['bloco_nome']})")
    conn.commit()
    conn.close()
    return {"message": "Manutenção marcada como resolvida e item restaurado para estado 'Bom'!"}

@app.delete("/api/moveis/{movel_id}")
def delete_movel(movel_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT m.tipo_item, q.numero as quarto_num, b.nome as bloco_nome
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE m.id = ?
    """, (movel_id,))
    item = cursor.fetchone()
    if not item:
        conn.close()
        raise HTTPException(status_code=404, detail="Item não encontrado")
        
    cursor.execute("DELETE FROM moveis_itens WHERE id = ?", (movel_id,))
    log_auditoria(conn, usuario, "EXCLUIR", "movel", movel_id, f"Item '{item['tipo_item']}' do Quarto {item['quarto_num']} excluído")
    conn.commit()
    conn.close()
    return {"message": "Item excluído com sucesso"}

# --- Empresas ---

@app.get("/api/empresas")
def get_empresas():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        e.id, e.nome, e.cor,
        COUNT(a.id) as total_alojados
    FROM empresas e
    LEFT JOIN alojados a ON a.empresa_id = e.id AND a.status = 'ativo'
    GROUP BY e.id
    ORDER BY total_alojados DESC, e.nome ASC
    """)
    empresas = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return empresas

@app.post("/api/empresas")
def create_empresa(req: EmpresaCreate):
    conn = get_db()
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO empresas (nome, cor) VALUES (?, ?)", (req.nome.strip().upper(), req.cor or "#3b82f6"))
        emp_id = cursor.lastrowid
        log_auditoria(conn, req.usuario, "CRIAR", "empresa", emp_id, f"Empresa '{req.nome.strip().upper()}' cadastrada")
        conn.commit()
        conn.close()
        return {"id": emp_id, "message": "Empresa cadastrada com sucesso"}
    except sqlite3.IntegrityError:
        conn.close()
        raise HTTPException(status_code=400, detail="Empresa já cadastrada")

@app.put("/api/empresas/{empresa_id}")
def update_empresa(empresa_id: int, req: EmpresaUpdate):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("UPDATE empresas SET nome = ?, cor = ? WHERE id = ?", (req.nome.strip().upper(), req.cor or "#3b82f6", empresa_id))
    log_auditoria(conn, req.usuario, "EDITAR", "empresa", empresa_id, f"Empresa alterada para '{req.nome.strip().upper()}'")
    conn.commit()
    conn.close()
    return {"message": "Empresa atualizada com sucesso"}

@app.delete("/api/empresas/{empresa_id}")
def delete_empresa(empresa_id: int, usuario: str = Query("prefeito")):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as ocupadas FROM alojados WHERE empresa_id = ? AND status = 'ativo'", (empresa_id,))
    if cursor.fetchone()["ocupadas"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Não é possível excluir empresa com alojados ativos vinculados.")
    cursor.execute("DELETE FROM empresas WHERE id = ?", (empresa_id,))
    log_auditoria(conn, usuario, "EXCLUIR", "empresa", empresa_id, f"Empresa ID {empresa_id} excluída")
    conn.commit()
    conn.close()
    return {"message": "Empresa excluída com sucesso"}

# --- Auditoria ---

@app.get("/api/auditoria")
def get_auditoria(
    usuario: Optional[str] = Query(None),
    acao: Optional[str] = Query(None),
    q: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500)
):
    conn = get_db()
    cursor = conn.cursor()
    query = "SELECT id, usuario, acao, entidade, entidade_id, detalhes, data_hora FROM auditoria_logs WHERE 1=1"
    params = []
    if usuario:
        query += " AND usuario = ?"
        params.append(usuario)
    if acao:
        query += " AND acao = ?"
        params.append(acao)
    if q:
        query += " AND detalhes LIKE ?"
        params.append(f"%{q}%")
    query += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    cursor.execute(query, params)
    logs = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return logs

# --- Relatórios & Exportações Excel ---

@app.get("/api/relatorios/resumo-geral")
def get_relatorio_resumo_geral():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        b.nome as alojamento,
        b.tipo as tipo,
        CASE 
            WHEN b.tipo = 'alojamento' THEN 'PRODUÇÃO'
            WHEN b.tipo = 'adm' THEN 'ADMINISTRAÇÃO'
            WHEN b.tipo = 'conteiner' THEN 'CONTÊINERES'
            ELSE 'OUTROS'
        END as descricao,
        COUNT(v.id) as total_vagas,
        SUM(CASE WHEN v.status = 'ocupada' THEN 1 ELSE 0 END) as ocupadas,
        SUM(CASE WHEN v.status = 'livre' THEN 1 ELSE 0 END) as vagas_livres
    FROM blocos b
    LEFT JOIN quartos q ON q.bloco_id = b.id
    LEFT JOIN vagas v ON v.quarto_id = q.id
    GROUP BY b.id
    ORDER BY b.ordem ASC
    """)
    linhas = [dict(r) for r in cursor.fetchall()]
    
    tot_vagas = sum(l["total_vagas"] or 0 for l in linhas)
    tot_ocup = sum(l["ocupadas"] or 0 for l in linhas)
    tot_livres = sum(l["vagas_livres"] or 0 for l in linhas)
    
    # Resumo por empresa por bloco
    cursor.execute("""
    SELECT 
        b.nome as bloco_nome,
        e.nome as empresa_nome,
        COUNT(a.id) as alojados
    FROM alojados a
    JOIN vagas v ON a.vaga_id = v.id
    JOIN quartos q ON v.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    JOIN empresas e ON a.empresa_id = e.id
    WHERE a.status = 'ativo'
    GROUP BY b.id, e.id
    ORDER BY b.ordem ASC, e.nome ASC
    """)
    empresa_bloco = [dict(r) for r in cursor.fetchall()]
    
    conn.close()
    return {
        "linhas": linhas,
        "totais": {
            "total_vagas": tot_vagas,
            "ocupadas": tot_ocup,
            "vagas_livres": tot_livres,
            "taxa_ocupacao": round((tot_ocup / tot_vagas * 100), 1) if tot_vagas > 0 else 0
        },
        "empresa_bloco": empresa_bloco
    }

@app.get("/api/relatorios/exportar-resumo-excel")
def exportar_resumo_excel():
    dados = get_relatorio_resumo_geral()
    linhas = dados["linhas"]
    totais = dados["totais"]
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "RESUMO GERAL"
    
    # Estilos
    font_title = Font(name="Segoe UI", size=14, bold=True, color="FFFFFF")
    fill_header_main = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    fill_header_cols = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    font_header_cols = Font(name="Segoe UI", size=11, bold=True, color="FFFFFF")
    font_bold = Font(name="Segoe UI", size=11, bold=True)
    font_regular = Font(name="Segoe UI", size=10)
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    fill_total = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
    
    # Título Principal
    ws.merge_cells("A1:E1")
    ws["A1"] = "RESUMO GERAL - OCUPAÇÃO DOS ALOJAMENTOS (CANTEIRO DE OBRA)"
    ws["A1"].font = font_title
    ws["A1"].fill = fill_header_main
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36
    
    ws["A2"] = f"Gerado em: {datetime.now().strftime('%d/%m/%Y às %H:%M')}"
    ws["A2"].font = Font(name="Segoe UI", size=9, italic=True, color="64748B")
    
    # Cabeçalho da Tabela
    headers = ["ALOJAMENTO / BLOCO", "DESCRIÇÃO / TIPO", "TOTAL DE VAGAS", "OCUPADAS", "DISPONÍVEIS"]
    ws.row_dimensions[4].height = 26
    for col_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=4, column=col_idx, value=h)
        cell.font = font_header_cols
        cell.fill = fill_header_cols
        cell.alignment = Alignment(horizontal="center" if col_idx > 2 else "left", vertical="center")
        cell.border = thin_border
        
    # Linhas de dados
    r_idx = 5
    for row_data in linhas:
        ws.row_dimensions[r_idx].height = 20
        c1 = ws.cell(row=r_idx, column=1, value=row_data["alojamento"])
        c2 = ws.cell(row=r_idx, column=2, value=row_data["descricao"])
        c3 = ws.cell(row=r_idx, column=3, value=row_data["total_vagas"])
        c4 = ws.cell(row=r_idx, column=4, value=row_data["ocupadas"])
        c5 = ws.cell(row=r_idx, column=5, value=row_data["vagas_livres"])
        
        for c in [c1, c2, c3, c4, c5]:
            c.font = font_regular
            c.border = thin_border
            if r_idx % 2 == 0:
                c.fill = fill_zebra
        c3.alignment = Alignment(horizontal="center")
        c4.alignment = Alignment(horizontal="center")
        c5.alignment = Alignment(horizontal="center")
        r_idx += 1
        
    # Linha Total
    ws.row_dimensions[r_idx].height = 24
    c1 = ws.cell(row=r_idx, column=1, value="TOTAL GERAL")
    c2 = ws.cell(row=r_idx, column=2, value=f"{len(linhas)} Blocos / {totais['taxa_ocupacao']}% Ocupado")
    c3 = ws.cell(row=r_idx, column=3, value=totais["total_vagas"])
    c4 = ws.cell(row=r_idx, column=4, value=totais["ocupadas"])
    c5 = ws.cell(row=r_idx, column=5, value=totais["vagas_livres"])
    for c in [c1, c2, c3, c4, c5]:
        c.font = font_bold
        c.fill = fill_total
        c.border = thin_border
    c3.alignment = Alignment(horizontal="center")
    c4.alignment = Alignment(horizontal="center")
    c5.alignment = Alignment(horizontal="center")
    
    # Auto-fit columns
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(max_len + 5, 14)
        
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    
    filename = f"Relatorio_Resumo_Ocupacao_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/relatorios/exportar-alojados-excel")
def exportar_alojados_excel(bloco_id: Optional[int] = Query(None), empresa_id: Optional[int] = Query(None)):
    conn = get_db()
    cursor = conn.cursor()
    query = """
    SELECT 
        a.matricula, a.nome_completo, a.funcao, e.nome as empresa,
        b.nome as bloco, q.numero as quarto, v.numero_cama,
        a.data_entrada, a.data_saida, a.status, a.observacoes
    FROM alojados a
    LEFT JOIN empresas e ON a.empresa_id = e.id
    LEFT JOIN vagas v ON a.vaga_id = v.id
    LEFT JOIN quartos q ON v.quarto_id = q.id
    LEFT JOIN blocos b ON q.bloco_id = b.id
    WHERE 1=1
    """
    params = []
    if bloco_id:
        query += " AND b.id = ?"
        params.append(bloco_id)
    if empresa_id:
        query += " AND a.empresa_id = ?"
        params.append(empresa_id)
    query += " ORDER BY a.status ASC, b.ordem ASC, CAST(q.numero AS INTEGER) ASC, v.numero_cama ASC, a.nome_completo ASC"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "LISTA DE ALOJADOS"
    
    font_title = Font(name="Segoe UI", size=14, bold=True, color="FFFFFF")
    fill_header_main = PatternFill(start_color="1E3A8A", end_color="1E3A8A", fill_type="solid")
    fill_header_cols = PatternFill(start_color="0284C7", end_color="0284C7", fill_type="solid")
    font_header_cols = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    font_regular = Font(name="Segoe UI", size=10)
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    fill_zebra = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
    
    ws.merge_cells("A1:K1")
    ws["A1"] = f"RELAÇÃO GERAL DE TRABALHADORES ALOJADOS - CANTEIRO DE OBRA ({len(rows)} Registros)"
    ws["A1"].font = font_title
    ws["A1"].fill = fill_header_main
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36
    
    headers = ["REG./MATRÍCULA", "NOME COMPLETO", "FUNÇÃO", "EMPRESA", "BLOCO", "QUARTO", "CAMA", "ENTRADA", "SAÍDA", "STATUS", "OBSERVAÇÕES"]
    ws.row_dimensions[3].height = 24
    for c_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=3, column=c_idx, value=h)
        cell.font = font_header_cols
        cell.fill = fill_header_cols
        cell.alignment = Alignment(horizontal="center" if c_idx in [1, 6, 7, 8, 9, 10] else "left", vertical="center")
        cell.border = thin_border
        
    for idx, r in enumerate(rows, 4):
        ws.row_dimensions[idx].height = 20
        c1 = ws.cell(row=idx, column=1, value=r["matricula"] or "-")
        c2 = ws.cell(row=idx, column=2, value=r["nome_completo"])
        c3 = ws.cell(row=idx, column=3, value=r["funcao"] or "-")
        c4 = ws.cell(row=idx, column=4, value=r["empresa"] or "-")
        c5 = ws.cell(row=idx, column=5, value=r["bloco"] or "Sem vaga")
        c6 = ws.cell(row=idx, column=6, value=r["quarto"] or "-")
        c7 = ws.cell(row=idx, column=7, value=r["numero_cama"] or "-")
        c8 = ws.cell(row=idx, column=8, value=r["data_entrada"] or "-")
        c9 = ws.cell(row=idx, column=9, value=r["data_saida"] or "-")
        c10 = ws.cell(row=idx, column=10, value="ATIVO" if r["status"] == "ativo" else "DESLIGADO")
        c11 = ws.cell(row=idx, column=11, value=r["observacoes"] or "")
        
        for c in [c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11]:
            c.font = font_regular
            c.border = thin_border
            if idx % 2 == 0:
                c.fill = fill_zebra
        c1.alignment = Alignment(horizontal="center")
        c6.alignment = Alignment(horizontal="center")
        c7.alignment = Alignment(horizontal="center")
        c8.alignment = Alignment(horizontal="center")
        c9.alignment = Alignment(horizontal="center")
        c10.alignment = Alignment(horizontal="center")
        
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(min(max_len + 4, 40), 12)
        
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    
    filename = f"Relatorio_Alojados_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/relatorios/exportar-moveis-danificados-excel")
def exportar_moveis_danificados_excel():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT 
        b.nome as bloco, q.numero as quarto, m.tipo_item, m.quantidade,
        m.estado_conservacao, m.precisa_manutencao, m.data_vistoria, m.observacoes
    FROM moveis_itens m
    JOIN quartos q ON m.quarto_id = q.id
    JOIN blocos b ON q.bloco_id = b.id
    WHERE m.estado_conservacao IN ('Ruim', 'Danificado') OR m.precisa_manutencao = 1
    ORDER BY b.ordem ASC, CAST(q.numero AS INTEGER) ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "MÓVEIS E ITENS DANIFICADOS"
    
    font_title = Font(name="Segoe UI", size=14, bold=True, color="FFFFFF")
    fill_header_main = PatternFill(start_color="991B1B", end_color="991B1B", fill_type="solid")
    fill_header_cols = PatternFill(start_color="DC2626", end_color="DC2626", fill_type="solid")
    font_header_cols = Font(name="Segoe UI", size=10, bold=True, color="FFFFFF")
    font_regular = Font(name="Segoe UI", size=10)
    thin_border = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    fill_zebra = PatternFill(start_color="FEF2F2", end_color="FEF2F2", fill_type="solid")
    
    ws.merge_cells("A1:H1")
    ws["A1"] = f"RELATÓRIO DE MÓVEIS E ITENS DANIFICADOS / MANUTENÇÃO PENDENTE ({len(rows)} Itens)"
    ws["A1"].font = font_title
    ws["A1"].fill = fill_header_main
    ws["A1"].alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36
    
    headers = ["BLOCO", "QUARTO", "TIPO DE ITEM", "QUANTIDADE", "ESTADO DE CONSERVAÇÃO", "MANUTENÇÃO?", "ÚLTIMA VISTORIA", "OBSERVAÇÕES"]
    ws.row_dimensions[3].height = 24
    for c_idx, h in enumerate(headers, 1):
        cell = ws.cell(row=3, column=c_idx, value=h)
        cell.font = font_header_cols
        cell.fill = fill_header_cols
        cell.alignment = Alignment(horizontal="center" if c_idx in [2, 4, 5, 6, 7] else "left", vertical="center")
        cell.border = thin_border
        
    for idx, r in enumerate(rows, 4):
        ws.row_dimensions[idx].height = 20
        c1 = ws.cell(row=idx, column=1, value=r["bloco"])
        c2 = ws.cell(row=idx, column=2, value=r["quarto"])
        c3 = ws.cell(row=idx, column=3, value=r["tipo_item"])
        c4 = ws.cell(row=idx, column=4, value=r["quantidade"])
        c5 = ws.cell(row=idx, column=5, value=r["estado_conservacao"])
        c6 = ws.cell(row=idx, column=6, value="SIM" if r["precisa_manutencao"] else "NÃO")
        c7 = ws.cell(row=idx, column=7, value=r["data_vistoria"] or "-")
        c8 = ws.cell(row=idx, column=8, value=r["observacoes"] or "")
        
        for c in [c1, c2, c3, c4, c5, c6, c7, c8]:
            c.font = font_regular
            c.border = thin_border
            if idx % 2 == 0:
                c.fill = fill_zebra
        c2.alignment = Alignment(horizontal="center")
        c4.alignment = Alignment(horizontal="center")
        c5.alignment = Alignment(horizontal="center")
        c6.alignment = Alignment(horizontal="center")
        c7.alignment = Alignment(horizontal="center")
        
    for col in ws.columns:
        max_len = max(len(str(cell.value or '')) for cell in col)
        col_letter = get_column_letter(col[0].column)
        ws.column_dimensions[col_letter].width = max(min(max_len + 4, 45), 14)
        
    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    
    filename = f"Relatorio_Itens_Danificados_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )

@app.get("/api/relatorios/exportar-planilha-oficial")
def exportar_planilha_oficial_endpoint():
    """
    Exporta a planilha no modelo 100% idêntico à original (ALOJAMENTO TABOCA 2),
    com todas as abas (BLOCOS ALOJAMENTO, BLOCOS ADM, RESUMO (2), BLOCOS CONTÊINER),
    cores, fontes, mesclagens e colunas lado a lado perfeitamente sincronizadas com o banco de dados.
    """
    from export_oficial import gerar_planilha_oficial
    stream = gerar_planilha_oficial()
    filename = f"ALOJAMENTO_TABOCA_2_OFICIAL_{datetime.now().strftime('%Y%m%d_%H%M')}.xlsx"
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


# --- Importação e Restauração ---

@app.post("/api/restaurar-padrao")
def restaurar_padrao(usuario: str = Query("prefeito")):
    import import_data
    import_data.run_import()
    conn = get_db()
    log_auditoria(conn, usuario, "RESTAURACAO", "sistema", 1, "Restauração do banco de dados a partir da planilha oficial Taboca 2")
    conn.commit()
    conn.close()
    return {"message": "Banco de dados restaurado com sucesso a partir da planilha original!"}

@app.post("/api/importar-planilha")
async def importar_planilha(file: UploadFile = File(...), usuario: str = Form("prefeito")):
    if not file.filename.endswith(('.xlsx', '.xlsm')):
        raise HTTPException(status_code=400, detail="O arquivo deve ser uma planilha Excel (.xlsx)")
        
    # Salvar temporariamente
    temp_path = os.path.join(BASE_DIR, 'temp_upload.xlsx')
    content = await file.read()
    with open(temp_path, 'wb') as f:
        f.write(content)
        
    # Executar importação com o arquivo temporário
    import import_data
    orig_file = import_data.EXCEL_FILE
    import_data.EXCEL_FILE = temp_path
    try:
        import_data.run_import()
        conn = get_db()
        log_auditoria(conn, usuario, "IMPORTACAO", "sistema", 1, f"Nova planilha importada pelo usuário: {file.filename}")
        conn.commit()
        conn.close()
    finally:
        import_data.EXCEL_FILE = orig_file
        if os.path.exists(temp_path):
            os.remove(temp_path)
            
    return {"message": f"Planilha '{file.filename}' importada com sucesso!"}

# --- Uploads e Frontend Estático ---

app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

frontend_dir = os.path.join(BASE_DIR, 'frontend')
os.makedirs(frontend_dir, exist_ok=True)
app.mount("/", StaticFiles(directory=frontend_dir, html=True), name="frontend")

if __name__ == '__main__':
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
