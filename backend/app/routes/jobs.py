from flask import Blueprint,request,jsonify
from flask_jwt_extended import get_jwt_identity,get_jwt
from app import db
from app.models.job import Job
from app.models.user import User
from app.services.notifications import notify
from app.utils.auth import roles
bp=Blueprint("jobs",__name__)
STATUSES={"Pending","Assigned","Accepted","In Progress","Paused","Completed","Cancelled"}
PRIORITIES={"Low","Medium","High","Urgent"}
def out(j):return {"id":j.id,"title":j.title,"description":j.description,"priority":j.priority,"status":j.status,"location":j.location,"due_date":j.due_date,"customer_id":j.customer_id,"machine_id":j.machine_id,"mechanic_id":j.mechanic_id}
@bp.get("")
@roles("boss","mechanic","customer")
def list_jobs():
    c=get_jwt();q=Job.query.filter_by(company_id=c["company_id"])
    if c["role"]=="mechanic":q=q.filter_by(mechanic_id=int(get_jwt_identity()))
    if c["role"]=="customer":q=q.filter_by(customer_id=c["customer_id"])
    return jsonify(jobs=[out(j) for j in q.order_by(Job.id.desc()).all()])
@bp.post("")
@roles("boss")
def create_job():
    d=request.json or {};c=get_jwt()
    if not d.get("title") or not d.get("description"):return jsonify(error="Title and description are required"),400
    priority=d.get("priority","Medium")
    if priority not in PRIORITIES:return jsonify(error="Invalid priority"),400
    mechanic_id=d.get("mechanic_id")
    if mechanic_id and not User.query.filter_by(id=mechanic_id,company_id=c["company_id"],role="mechanic").first():return jsonify(error="Mechanic not found"),404
    j=Job(company_id=c["company_id"],title=d["title"],description=d["description"],priority=priority,location=d.get("location"),due_date=d.get("due_date"),customer_id=d.get("customer_id"),machine_id=d.get("machine_id"),mechanic_id=mechanic_id,status="Assigned" if mechanic_id else "Pending")
    db.session.add(j);db.session.flush()
    if j.mechanic_id:notify(j.mechanic_id,"New task assigned",f'{j.title} was assigned to you.',"job")
    db.session.commit();return jsonify(job=out(j)),201
@bp.patch("/<int:jid>")
@roles("boss","mechanic")
def update_job(jid):
    j=Job.query.filter_by(id=jid,company_id=get_jwt()["company_id"]).first_or_404();d=request.json or {};role=get_jwt()["role"];uid=int(get_jwt_identity())
    if role=="mechanic" and j.mechanic_id!=uid:return jsonify(error="Forbidden"),403
    if role=="mechanic" and set(d)-{"status"}:return jsonify(error="Mechanics can only update job status"),403
    if "status" in d and d["status"] not in STATUSES:return jsonify(error="Invalid status"),400
    if "priority" in d and d["priority"] not in PRIORITIES:return jsonify(error="Invalid priority"),400
    old=j.status
    if role=="mechanic" and d.get("status") not in {"Accepted","In Progress","Paused","Completed"}:return jsonify(error="Mechanics cannot decline or cancel jobs"),403
    if "title" in d:j.title=d["title"]
    if "description" in d:j.description=d["description"]
    if "priority" in d:j.priority=d["priority"]
    if "location" in d:j.location=d["location"]
    if "due_date" in d:j.due_date=d["due_date"]
    j.status=d.get("status",j.status)
    if role=="boss" and "mechanic_id" in d:
        if d["mechanic_id"] and not User.query.filter_by(id=d["mechanic_id"],company_id=j.company_id,role="mechanic").first():return jsonify(error="Mechanic not found"),404
        j.mechanic_id=d["mechanic_id"]
        if j.status=="Pending" and j.mechanic_id:j.status="Assigned"
        if j.mechanic_id:notify(j.mechanic_id,"New task assigned",f'{j.title} was assigned to you.',"job")
    db.session.commit()
    if old!=j.status and role=="mechanic":
        boss=User.query.filter_by(company_id=j.company_id,role="boss").first()
        if boss:notify(boss.id,"Job status updated",f"{j.title} is now {j.status}.","status")
    return jsonify(job=out(j))

@bp.delete("/<int:jid>")
@roles("boss")
def delete_job(jid):
    j=Job.query.filter_by(id=jid,company_id=get_jwt()["company_id"]).first_or_404()
    db.session.delete(j);db.session.commit();return jsonify(ok=True)
