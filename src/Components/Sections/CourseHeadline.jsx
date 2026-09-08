import React from "react";

const DashStyles = {
  color: "white",
  textAlign: "center",
  backgroundImage: "url(/images/classroom.png)",
  backgroundRepeat: "no-repeat",
  backgroundSize: "cover",
  position: "relative",
  borderRadius: "30px",
  display: "flex",
  height: "300px",
  justifyContent: "space-between",
  backgroundPosition: "right",
  backgroundColor: "gray",
  headOne: { fontWeight: "600" },
  headTwo: { fontWeight: "500" },
  headFour: { fontWeight: "400" },
  topDiv: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    position: "relative",
    width: "100%",
  },
  spanStyle: {
    display: "flex",
    flexDirection: "column",
    margin: "auto",
  },
};

const CourseHeadline = ({ course }) => (
  <div className="CourseHeadline" style={DashStyles.topDiv}>
    <div style={DashStyles} className="setBg">
      <span style={DashStyles.spanStyle}>
        <h1 style={DashStyles.headOne}>{course.code}</h1>
        {course.title ? (
          <h3 style={DashStyles.headTwo}>{course.title}</h3>
        ) : null}
        <h4 style={DashStyles.headFour}>{`${course.level_year} level`}</h4>
      </span>
    </div>
  </div>
);

export default CourseHeadline;
