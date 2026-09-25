import sqlite3
import os
import hashlib
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(__file__), 'alojamento.db')

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode('utf-8')).hexdigest()

def init_database():
    conn = get_db()
    cursor = conn.cursor()
    
    # 1. Empresas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS empresas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE NOT NULL,
        cor TEXT DEFAULT '#3b82f6',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # 2. Funcoes
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS funcoes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE NOT NULL
    )
    """)
    
    # 3. Blocos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS blocos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nome TEXT UNIQUE NOT NULL,
        tipo TEXT NOT NULL, -- 'alojamento', 'adm', 'conteiner'
        ordem INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # 4. Quartos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS quartos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bloco_id INTEGER NOT NULL,
        numero TEXT NOT NULL,
        capacidade INTEGER NOT NULL DEFAULT 4,
        observacoes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bloco_id) REFERENCES blocos (id) ON DELETE CASCADE,
        UNIQUE (bloco_id, numero)
    )
    """)
    
    # 5. Vagas / Camas
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS vagas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quarto_id INTEGER NOT NULL,
        numero_cama INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'livre', -- 'livre', 'ocupada', 'manutencao'
        observacoes TEXT,
        FOREIGN KEY (quarto_id) REFERENCES quartos (id) ON DELETE CASCADE,
        UNIQUE (quarto_id, numero_cama)
    )
    """)
    
    # 6. Alojados
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS alojados (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vaga_id INTEGER,
        matricula TEXT,
        nome_completo TEXT NOT NULL,
        empresa_id INTEGER,
        funcao TEXT,
        data_entrada DATE,
        data_saida DATE,
        status TEXT NOT NULL DEFAULT 'ativo', -- 'ativo', 'desligado'
        observacoes TEXT,
        foto_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vaga_id) REFERENCES vagas (id) ON DELETE SET NULL,
        FOREIGN KEY (empresa_id) REFERENCES empresas (id) ON DELETE SET NULL
    )
    """)
    
    # 7. Moveis e Itens do quarto
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS moveis_itens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quarto_id INTEGER NOT NULL,
        tipo_item TEXT NOT NULL, -- 'Cama / Beliche', 'Colchão', 'Guarda-roupa', 'Ventilador', 'Ar-Condicionado', 'Lâmpada', 'Tomada', etc.
        quantidade INTEGER NOT NULL DEFAULT 1,
        estado_conservacao TEXT NOT NULL DEFAULT 'Bom', -- 'Bom', 'Regular', 'Ruim', 'Danificado'
        precisa_manutencao INTEGER DEFAULT 0, -- 0 = Não, 1 = Sim
        data_vistoria DATE,
        observacoes TEXT,
        foto_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (quarto_id) REFERENCES quartos (id) ON DELETE CASCADE
    )
    """)
    
    # 8. Auditoria Logs
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS auditoria_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario TEXT NOT NULL,
        acao TEXT NOT NULL, -- 'CRIAR', 'EDITAR', 'EXCLUIR', 'REALOCAR', 'DESLIGAR', 'LOGIN', 'IMPORTACAO'
        entidade TEXT NOT NULL, -- 'alojado', 'quarto', 'bloco', 'movel', 'empresa', etc.
        entidade_id INTEGER,
        detalhes TEXT NOT NULL,
        data_hora DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # 9. Usuarios
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        senha_hash TEXT NOT NULL,
        nome TEXT NOT NULL,
        perfil TEXT NOT NULL, -- 'prefeito' (admin total), 'consulta' (read-only)
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
    """)
    
    # Inserir usuários padrão se não existirem
    cursor.execute("SELECT id FROM usuarios WHERE username = 'prefeito'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO usuarios (username, senha_hash, nome, perfil)
        VALUES ('prefeito', ?, 'Prefeito da Obra (Admin)', 'prefeito')
        """, (hash_password('admin123'),))
        
    cursor.execute("SELECT id FROM usuarios WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO usuarios (username, senha_hash, nome, perfil)
        VALUES ('admin', ?, 'Administrador Geral', 'prefeito')
        """, (hash_password('admin123'),))
        
    cursor.execute("SELECT id FROM usuarios WHERE username = 'consulta'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO usuarios (username, senha_hash, nome, perfil)
        VALUES ('consulta', ?, 'Fiscal / Consulta (Leitura)', 'consulta')
        """, (hash_password('consulta123'),))
        
    conn.commit()
    conn.close()
    print("Database tables initialized successfully!")

if __name__ == '__main__':
    init_database()
