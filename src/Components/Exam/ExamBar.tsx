import React, { useEffect } from "react";
import { Link } from "react-router-dom";
import Logo from "../Logo";
import { useSchool } from "../../context/SchoolContext";

// The only header on an exam (2026-10-15). A pupil sitting a paper sees the
// school's logo and name and nothing else: no menu, search, Ask AI,
// notifications or mail pop-ups, and no "Write with AI" on any box. The
// `exam-mode` class on <body> is what global helpers check to stay away.
const ExamBar = ({ back }: { back?: string }) => {
  const { school } = useSchool();
  const logo = (school as { logo_url?: string } | null)?.logo_url;

  useEffect(() => {
    document.body.classList.add("exam-mode");
    return () => document.body.classList.remove("exam-mode");
  }, []);

  return (
    <header className="topbar tw-justify-between">
      <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-3">
        {logo ? <img src={logo} alt="" className="tw-h-9 tw-w-9 tw-rounded-lg tw-object-cover" /> : <Logo size={32} showName={false} suffix={undefined} />}
        <span className="tw-truncate tw-text-[16px] tw-font-bold tw-text-ink">{school?.name || "Schoolivio"}</span>
      </span>
      {back ? (
        <Link to={back} className="tw-whitespace-nowrap tw-text-[14px] tw-font-semibold tw-text-brand tw-no-underline hover:tw-underline">
          {"Leave"}
        </Link>
      ) : (
        <span className="tw-whitespace-nowrap tw-rounded-full tw-bg-brand-soft tw-px-3 tw-py-1 tw-text-[12.5px] tw-font-semibold tw-text-brand">{"Exam in progress"}</span>
      )}
    </header>
  );
};

export default ExamBar;
