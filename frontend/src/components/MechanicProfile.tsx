import { useEffect, useState } from "react";
import { X, Star, CheckCircle2, Clock, Wrench } from "lucide-react";
import { jobs, reviews } from "../services/api";

type Props = { mechanic: any; onClose: () => void };

export default function MechanicProfile({ mechanic, onClose }: Props) {
  const [jobsData, setJobsData] = useState<any[]>([]);
  const [reviewsData, setReviewsData] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([jobs(), reviews()])
      .then(([j, r]) => {
        const mechanicJobs = j.jobs.filter((x: any) => x.mechanic_id === mechanic.id);
        const mechanicReviews = r.reviews.filter((x: any) => x.mechanic_id === mechanic.id);
        setJobsData(mechanicJobs);
        setReviewsData(mechanicReviews);
      })
      .catch(() => {});
  }, [mechanic.id]);

  const completed = jobsData.filter((x) => x.status === "Completed").length;
  const avgRating = reviewsData.length > 0
    ? (reviewsData.reduce((sum, r) => sum + r.rating, 0) / reviewsData.length).toFixed(1)
    : null;

  return (
    <div className="modal" onClick={onClose}>
      <div className="modalContent" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2>Mechanic Profile</h2>
          <button className="closeBtn" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="profileView">
          <div className="profileHeader">
            <div className="avatarLarge">{mechanic.name[0]}</div>
            <div>
              <h3>{mechanic.name}</h3>
              <p>{mechanic.email}</p>
            </div>
          </div>

          <div className="profileStats">
            <div className="statCard">
              <Wrench size={20} />
              <div>
                <strong>{jobsData.length}</strong>
                <span>Total jobs</span>
              </div>
            </div>
            <div className="statCard">
              <CheckCircle2 size={20} />
              <div>
                <strong>{completed}</strong>
                <span>Completed</span>
              </div>
            </div>
            {avgRating && (
              <div className="statCard">
                <Star size={20} />
                <div>
                  <strong>{avgRating}</strong>
                  <span>Avg rating ({reviewsData.length})</span>
                </div>
              </div>
            )}
          </div>

          {reviewsData.length > 0 && (
            <div className="profileSection">
              <h4>Recent reviews</h4>
              <div className="reviewsList">
                {reviewsData.slice(0, 5).map((r) => (
                  <div key={r.id} className="reviewItem">
                    <div className="reviewRating">
                      {Array(5)
                        .fill(0)
                        .map((_, i) => (
                          <Star
                            key={i}
                            size={14}
                            fill={i < r.rating ? "currentColor" : "none"}
                          />
                        ))}
                    </div>
                    <p>{r.comment}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {jobsData.length > 0 && (
            <div className="profileSection">
              <h4>Recent work</h4>
              <div className="jobsList">
                {jobsData.slice(0, 5).map((j) => (
                  <div key={j.id} className="jobItem">
                    <div>
                      <b>{j.title}</b>
                      <small>{j.location || "No location"}</small>
                    </div>
                    <span className={`status ${j.status.replace(/ /g, "").toLowerCase()}`}>
                      {j.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
