import hashlib,json,mimetypes,os,secrets,sqlite3,uuid
from datetime import datetime,timezone
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path

ROOT=Path(__file__).parent; DB=ROOT/'acuity.db'; UPLOADS=ROOT/'private_uploads'; UPLOADS.mkdir(exist_ok=True)
STATUSES=['PENDING','DOCUMENT_VERIFICATION','UNDER_REVIEW','APPROVED','REJECTED','DISBURSED','CLOSED']
def now(): return datetime.now(timezone.utc).isoformat()
def conn():
 c=sqlite3.connect(DB);c.row_factory=sqlite3.Row;c.execute('PRAGMA foreign_keys=ON');return c
def hashpw(p,s=None):
 s=s or secrets.token_hex(16);return s+'$'+hashlib.pbkdf2_hmac('sha256',p.encode(),s.encode(),200000).hex()
def verify(p,h):
 s,_=h.split('$',1);return secrets.compare_digest(hashpw(p,s),h)
def init():
 c=conn();c.executescript('''CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT NOT NULL,password_hash TEXT NOT NULL,date_of_birth TEXT,gender TEXT,address TEXT,city TEXT,state TEXT,pincode TEXT,employment_type TEXT,company_name TEXT,monthly_income REAL,pan TEXT,role TEXT NOT NULL DEFAULT 'CLIENT',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS loan_applications(id TEXT PRIMARY KEY,application_number TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),loan_type TEXT NOT NULL,loan_amount REAL NOT NULL,interest_rate REAL,tenure INTEGER NOT NULL,purpose TEXT NOT NULL,monthly_income REAL,existing_emi REAL DEFAULT 0,status TEXT NOT NULL DEFAULT 'PENDING',admin_remarks TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS application_documents(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),document_type TEXT NOT NULL,file_name TEXT NOT NULL,file_path TEXT NOT NULL,verification_status TEXT NOT NULL DEFAULT 'PENDING',admin_remarks TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS application_status_history(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,status TEXT NOT NULL,remarks TEXT,changed_by TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),application_id TEXT REFERENCES loan_applications(id),title TEXT NOT NULL,message TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);''')
 if not c.execute("SELECT 1 FROM users WHERE role='ADMIN'").fetchone():
  t=now();c.execute("INSERT INTO users(id,full_name,email,phone,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",('admin-001','Acuity Administrator','admin@acuity.local','0000000000',hashpw(os.environ.get('ACUITY_ADMIN_PASSWORD','ChangeMe123!')),'ADMIN',t,t))
 c.commit();c.close()
class App(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def data(self):
  try:return json.loads(self.rfile.read(int(self.headers.get('Content-Length',0)))or'{}')
  except:return {}
 def out(self,obj,status=200,cookie=None):
  raw=json.dumps(obj).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store')
  if cookie:self.send_header('Set-Cookie',cookie)
  self.end_headers();self.wfile.write(raw)
 def auth(self,role=None):
  ck=SimpleCookie(self.headers.get('Cookie'));t=ck.get('acuity_session')
  if not t:return None
  c=conn();u=c.execute('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?',(t.value,)).fetchone();c.close()
  return dict(u) if u and (not role or u['role']==role) else None
 def api(self):
  p=self.path.split('?')[0];d=self.data();u=self.auth()
  if p=='/api/auth/register' and self.command=='POST':
   need=['full_name','email','phone','password']
   if any(not d.get(x) for x in need) or len(d['password'])<8:return self.out({'error':'Name, email, phone and an 8-character password are required.'},400)
   c=conn();uid='cli-'+uuid.uuid4().hex[:12];t=now()
   try:c.execute('INSERT INTO users(id,full_name,email,phone,password_hash,date_of_birth,gender,address,city,state,pincode,employment_type,company_name,monthly_income,pan,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(uid,d['full_name'],d['email'].lower(),d['phone'],hashpw(d['password']),d.get('date_of_birth'),d.get('gender'),d.get('address'),d.get('city'),d.get('state'),d.get('pincode'),d.get('employment_type'),d.get('company_name'),d.get('monthly_income'),d.get('pan'),'CLIENT',t,t));c.commit()
   except sqlite3.IntegrityError:return self.out({'error':'An account with this email already exists.'},409)
   finally:c.close()
   return self.out({'id':uid,'message':'Registration successful.'},201)
  if p=='/api/auth/login' and self.command=='POST':
   c=conn();row=c.execute('SELECT * FROM users WHERE email=?',(d.get('email','').lower(),)).fetchone();c.close()
   if not row or not verify(d.get('password',''),row['password_hash']):return self.out({'error':'Invalid email or password.'},401)
   token=secrets.token_urlsafe(32);c=conn();c.execute('INSERT INTO sessions VALUES(?,?,?)',(token,row['id'],now()));c.commit();c.close();return self.out({'role':row['role'],'name':row['full_name']},cookie=f'acuity_session={token}; HttpOnly; SameSite=Lax; Path=/')
  if p=='/api/auth/logout' and self.command=='POST':return self.out({'ok':True},cookie='acuity_session=; Max-Age=0; Path=/')
  if p=='/api/client/profile' and u and u['role']=='CLIENT':
   if self.command=='PUT':
    fields=['full_name','phone','date_of_birth','gender','address','city','state','pincode','employment_type','company_name','monthly_income','pan'];values=[d.get(x) for x in fields];c=conn();c.execute('UPDATE users SET '+','.join(x+'=?' for x in fields)+',updated_at=? WHERE id=?',(*values,now(),u['id']));c.commit();c.close();return self.out({'ok':True})
   return self.out({'user':{k:u[k] for k in u if k not in ('password_hash',)}})
  if p.startswith('/api/client/applications/') and u and u['role']=='CLIENT' and self.command=='GET':
   aid=p.split('/')[4];c=conn();app=c.execute('SELECT * FROM loan_applications WHERE id=? AND user_id=?',(aid,u['id'])).fetchone();hist=c.execute('SELECT * FROM application_status_history WHERE application_id=? ORDER BY created_at DESC',(aid,)).fetchall();docs=c.execute('SELECT id,application_id,document_type,file_name,verification_status,admin_remarks,created_at FROM application_documents WHERE application_id=? AND user_id=?',(aid,u['id'])).fetchall();c.close();return self.out({'application':dict(app),'history':[dict(x) for x in hist],'documents':[dict(x) for x in docs]}) if app else self.out({'error':'Not found'},404)
  if p.startswith('/api/client/applications/') and p.endswith('/documents') and u and u['role']=='CLIENT' and self.command=='POST':
   aid=p.split('/')[4];document_type=d.get('document_type','Supporting document');file_name=os.path.basename(d.get('file_name','upload'));content=d.get('content','')
   if not content or len(content)>7_000_000:return self.out({'error':'A document file is required and must be under 5 MB.'},400)
   import base64
   try:raw=base64.b64decode(content.split(',',1)[-1],validate=True)
   except Exception:return self.out({'error':'Invalid document data.'},400)
   if len(raw)>5*1024*1024:return self.out({'error':'A document file is too large.'},400)
   c=conn();exists=c.execute('SELECT id FROM loan_applications WHERE id=? AND user_id=?',(aid,u['id'])).fetchone()
   if not exists:c.close();return self.out({'error':'Not found'},404)
   folder=UPLOADS/aid;folder.mkdir(exist_ok=True);stored=uuid.uuid4().hex+'-'+file_name;path=folder/stored;path.write_bytes(raw);docid='doc-'+uuid.uuid4().hex[:12];t=now();c.execute('INSERT INTO application_documents VALUES(?,?,?,?,?,?,?,?,?,?)',(docid,aid,u['id'],document_type,file_name,str(path.relative_to(ROOT)),'PENDING',None,t));c.commit();c.close();return self.out({'id':docid,'message':'Document uploaded.'},201)
  if p=='/api/client/notifications' and u and u['role']=='CLIENT' and self.command=='GET':
   c=conn();items=c.execute('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC',(u['id'],)).fetchall();c.close();return self.out({'notifications':[dict(x) for x in items]})
  if p=='/api/client/applications' and u and u['role']=='CLIENT':
   c=conn()
   if self.command=='GET':r=c.execute('SELECT * FROM loan_applications WHERE user_id=? ORDER BY created_at DESC',(u['id'],)).fetchall();c.close();return self.out({'applications':[dict(x) for x in r]})
   if self.command=='POST':
    for x in ['loan_type','loan_amount','tenure','purpose']:
     if not d.get(x):c.close();return self.out({'error':'Missing loan information.'},400)
    aid='app-'+uuid.uuid4().hex[:12];num='AF-'+uuid.uuid4().hex[:8].upper();t=now();c.execute('INSERT INTO loan_applications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(aid,num,u['id'],d['loan_type'],float(d['loan_amount']),d.get('interest_rate'),int(d['tenure']),d['purpose'],d.get('monthly_income'),d.get('existing_emi',0),'PENDING',None,t,t));c.execute('INSERT INTO application_status_history VALUES(?,?,?,?,?,?)',(uuid.uuid4().hex,aid,'PENDING','Application submitted',u['id'],t));c.commit();c.close();return self.out({'id':aid,'application_number':num},201)
  if p=='/api/admin/dashboard' and u and u['role']=='ADMIN':
   c=conn();r=c.execute("SELECT COUNT(*) clients,(SELECT COUNT(*) FROM loan_applications) applications,(SELECT COUNT(*) FROM loan_applications WHERE status='PENDING') pending,(SELECT COALESCE(SUM(loan_amount),0) FROM loan_applications) total FROM users WHERE role='CLIENT'").fetchone();c.close();return self.out({'stats':dict(r)})
  if p=='/api/admin/clients' and u and u['role']=='ADMIN':
   c=conn();r=c.execute("SELECT u.id,u.full_name,u.email,u.phone,u.employment_type,u.monthly_income,u.created_at,COUNT(a.id) applications FROM users u LEFT JOIN loan_applications a ON a.user_id=u.id WHERE u.role='CLIENT' GROUP BY u.id ORDER BY u.created_at DESC").fetchall();c.close();return self.out({'clients':[dict(x) for x in r]})
  if p=='/api/admin/applications' and u and u['role']=='ADMIN':
   c=conn();r=c.execute('SELECT a.*,u.full_name,u.email,u.phone FROM loan_applications a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC').fetchall();c.close();return self.out({'applications':[dict(x) for x in r]})
  if p.startswith('/api/admin/applications/') and p.endswith('/status') and self.command=='PUT' and u and u['role']=='ADMIN':
   aid=p.split('/')[4];status=d.get('status'); 
   if status not in STATUSES:return self.out({'error':'Invalid status.'},400)
   else:
    c=conn();t=now();c.execute('UPDATE loan_applications SET status=?,admin_remarks=?,updated_at=? WHERE id=?',(status,d.get('remarks'),t,aid));c.execute('INSERT INTO application_status_history VALUES(?,?,?,?,?,?)',(uuid.uuid4().hex,aid,status,d.get('remarks'),u['id'],t));row=c.execute('SELECT user_id,application_number FROM loan_applications WHERE id=?',(aid,)).fetchone();c.execute('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)',('note-'+uuid.uuid4().hex[:12],row['user_id'],aid,'Application status updated','Your application '+row['application_number']+' is now '+status+'.',0,t));c.commit();c.close();return self.out({'ok':True})
  if p.startswith('/api/admin/applications/') and p.endswith('/documents') and self.command=='GET' and u and u['role']=='ADMIN':
   aid=p.split('/')[4];c=conn();docs=c.execute('SELECT * FROM application_documents WHERE application_id=?',(aid,)).fetchall();c.close();return self.out({'documents':[dict(x) for x in docs]})
  if p.startswith('/api/admin/applications/') and self.command=='GET' and u and u['role']=='ADMIN':
   aid=p.split('/')[4];c=conn();app=c.execute('SELECT a.*,u.full_name,u.email,u.phone,u.address,u.city,u.state,u.employment_type,u.monthly_income,u.company_name FROM loan_applications a JOIN users u ON a.user_id=u.id WHERE a.id=?',(aid,)).fetchone();docs=c.execute('SELECT * FROM application_documents WHERE application_id=?',(aid,)).fetchall();hist=c.execute('SELECT * FROM application_status_history WHERE application_id=? ORDER BY created_at DESC',(aid,)).fetchall();c.close();return self.out({'application':dict(app),'documents':[dict(x) for x in docs],'history':[dict(x) for x in hist]}) if app else self.out({'error':'Not found'},404)
  if p.startswith('/api/admin/clients/') and self.command=='DELETE' and u and u['role']=='ADMIN':
   cid=p.split('/')[4];c=conn();client=c.execute("SELECT id FROM users WHERE id=? AND role='CLIENT'",(cid,)).fetchone()
   if not client:c.close();return self.out({'error':'Client not found.'},404)
   c.execute('DELETE FROM notifications WHERE user_id=?',(cid,));c.execute('DELETE FROM application_documents WHERE user_id=?',(cid,));c.execute('DELETE FROM application_status_history WHERE application_id IN (SELECT id FROM loan_applications WHERE user_id=?)',(cid,));c.execute('DELETE FROM loan_applications WHERE user_id=?',(cid,));c.execute('DELETE FROM sessions WHERE user_id=?',(cid,));c.execute('DELETE FROM users WHERE id=?',(cid,));c.commit();c.close();return self.out({'ok':True})
  if p.startswith('/api/admin/clients/') and self.command=='GET' and u and u['role']=='ADMIN':
    cid=p.split('/')[4];c=conn();cli=c.execute('SELECT id,full_name,email,phone,date_of_birth,gender,address,city,state,pincode,employment_type,company_name,monthly_income,pan,role,created_at,updated_at FROM users WHERE id=? AND role=?',(cid,'CLIENT')).fetchone();apps=c.execute('SELECT * FROM loan_applications WHERE user_id=? ORDER BY created_at DESC',(cid,)).fetchall();c.close();return self.out({'client':dict(cli),'applications':[dict(x) for x in apps]}) if cli else self.out({'error':'Not found'},404)
  return self.out({'error':'Not found or unauthorized.'},403 if not u else 404)
 def do_GET(self):
  if self.path.split('?')[0] in ('/','/index.html','/admin'):
   page=(ROOT/'index.html').read_text(encoding='utf-8');raw=page.encode();self.send_response(200);self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(raw)));self.end_headers();self.wfile.write(raw);return
  if self.path.startswith('/api/'):return self.api()
  return super().do_GET()
 def do_POST(self):return self.api() if self.path.startswith('/api/') else self.out({'error':'Not found'},404)
 def do_PUT(self):return self.api() if self.path.startswith('/api/') else self.out({'error':'Not found'},404)
 def do_DELETE(self):return self.api() if self.path.startswith('/api/') else self.out({'error':'Not found'},404)
if __name__=='__main__':init();print('Acuity Finance: http://localhost:8000');ThreadingHTTPServer(('localhost',8000),App).serve_forever()
