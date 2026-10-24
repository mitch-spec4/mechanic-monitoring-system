import { useEffect, useState } from "react";
import { X, Star, CheckCircle2, Clock, Wrench } from "lucide-react";
import { jobs, reviews } from "../services/api";
import type { Job, Mechanic, Review } from "../services/types";
import { t } from "../i18n";

type Props = { mechanic: Mechanic; onClose: () => void };

export default function MechanicProfile({ mechanic, onClose }: Props) {
  const [jobsData, setJobsData] = useState<Job[]>([]);
  const [reviewsData, setReviewsData] = useState<Review[]>([]);

  useEffect(() => {
    Promise.all([jobs(), reviews()])
      .then(([j, r]) => {
        setJobsData(j.jobs.filter((job) => job.mechanic_id === mechanic.id));
        setReviewsData(r.reviews.filter((review) => review.mechanic_id === mechanic.id));
      })
      .catch(() => {});
  }, [mechanic.id]);

  const completed = jobsData.filter((x) => x.status === "Completed").length;
  const avgRating = reviewsData.length > 0
    ? (reviewsData.reduce((sum, r) => sum + r.rating, 0) / reviewsData.length).toFixed(1)
    : null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal profileModal" role="dialog" aria-modal="true" aria-labelledby="technician-profile-title" onClick={(e) => e.stopPropagation()}>
        <div className="modalHeader">
          <h2 id="technician-profile-title">{t("Technician profile")}</h2>
          <button className="closeBtn" onClick={onClose} aria-label={t("Close")}>
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
                <span>{t("Total jobs")}</span>
              </div>
            </div>
            <div className="statCard">
              <CheckCircle2 size={20} />
              <div>
                <strong>{completed}</strong>
                <span>{t("Completed")}</span>
              </div>
            </div>
            {avgRating && (
              <div className="statCard">
                <Star size={20} />
                <div>
                  <strong>{avgRating}</strong>
                  <span>{t("Average rating ({count})", { count: reviewsData.length })}</span>
                </div>
              </div>
            )}
          </div>

          {reviewsData.length > 0 && (
            <div className="profileSection">
              <h4>{t("Recent reviews")}</h4>
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
              <h4>{t("Recent work")}</h4>
              <div className="jobsList">
                {jobsData.slice(0, 5).map((j) => (
                  <div key={j.id} className="jobItem">
                    <div>
                      <b>{j.title}</b>
                      <small>{j.location || t("No site")}</small>
                    </div>
                    <span className={`status ${j.status.replace(/ /g, "").toLowerCase()}`}>{t(j.status)}</span>
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
