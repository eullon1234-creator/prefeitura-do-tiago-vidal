import re

def fix_pt_text(text):
    if not text:
        return text
    # Remove null bytes or weird unprintable chars
    s = str(text).replace('\x00', '').strip()
    
    # Common replacements
    replacements = [
        ('LOURENO', 'LOURENÇO'),
        ('CONCEIAO', 'CONCEIÇÃO'),
        ('CONCEIO', 'CONCEIÇÃO'),
        ('JOSE', 'JOSÉ'),
        ('JOAO', 'JOÃO'),
        ('FUNO', 'FUNÇÃO'),
        ('FUNAO', 'FUNÇÃO'),
        ('MANUTENAO', 'MANUTENÇÃO'),
        ('MANUTENO', 'MANUTENÇÃO'),
        ('LUBRIFICAO', 'LUBRIFICAÇÃO'),
        ('LUBRIFICAAO', 'LUBRIFICAÇÃO'),
        ('PRODUO', 'PRODUÇÃO'),
        ('DESCRIO', 'DESCRIÇÃO'),
        ('OCUPAO', 'OCUPAÇÃO'),
        ('CONTINER', 'CONTÊINER'),
        ('Continer', 'Contêiner'),
        ('DISPONVEL', 'DISPONÍVEL'),
        ('DISPONIVEL', 'DISPONÍVEL'),
        ('SEBASTIO', 'SEBASTIÃO'),
        ('CRISTOVO', 'CRISTÓVÃO'),
        ('MARAL', 'MARÇAL'),
        ('PA-CARREGADEIRA', 'PÁ-CARREGADEIRA'),
        ('PA CARREGADEIRA', 'PÁ-CARREGADEIRA'),
        ('VIBRADOSRISTA', 'VIBRADORISTA'),
        ('LEDER DE EQUIPE', 'LÍDER DE EQUIPE'),
        ('LIDER DE EQUIPE', 'LÍDER DE EQUIPE'),
    ]
    for orig, target in replacements:
        s = s.replace(orig, target)
        
    s = re.sub(r'\s+', ' ', s).strip()
    return s
