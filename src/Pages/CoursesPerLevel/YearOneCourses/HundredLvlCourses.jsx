import React from "react";
import { Link } from "react-router-dom";
import { YearStyle } from "../YearStyle";

const HundredLvlCourses = () => {
  const lvlCourseList = [
    { course_id: "1", course: "STAT101" },
    { course_id: "2", course: "GEDS131" },
    { course_id: "3", course: "MATH101" },
    { course_id: "4", course: "COSC108" },
    { course_id: "5", course: "GEDS101" },
    { course_id: "6", course: "COSC107" },
    { course_id: "7", course: "PHYS101" },
    { course_id: "8", course: "CHEM101" },
    { course_id: "9", course: "COSC111" },
    { course_id: "10", course: "GEDS107" },
    { course_id: "11", course: "GEDS126" },
    { course_id: "12", course: "COSC112" },
    { course_id: "13", course: "PHYS102" },
    { course_id: "14", course: "MATH102" },
    { course_id: "15", course: "MATH104" },
    { course_id: "16", course: "GEDS112" },
    { course_id: "17", course: "GEDS105" },
    { course_id: "18", course: "GEDS132" },
    { course_id: "19", course: "GEDS134" },
  ];

  return (
    <div className="HundredLvlCourses">
      <h1 style={YearStyle.headStyle}>{"100 Level Courses:"}</h1>
      <div className="HundredLvl-boxes " style={YearStyle}>
        {lvlCourseList.map((courseObject, i) => {
          switch (courseObject.course_id) {
            case "1":
              return (
                <Link
                  to={"/Levels/100/Courses/STAT101"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={courseObject.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{courseObject.course}</h2>
                  </div>
                </Link>
              );
            case "2":
              return (
                <Link
                  to={"/Levels/100/Courses/GEDS131"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={courseObject.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{courseObject.course}</h2>
                  </div>
                </Link>
              );
            case "3":
              return (
                <Link
                  to={"/Levels/100/Courses/MATH101"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={courseObject.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{courseObject.course}</h2>
                  </div>
                </Link>
              );
            case "4":
              return (
                <Link
                  to={"/Levels/100/Courses/STAT101"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={courseObject.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{courseObject.course}</h2>
                  </div>
                </Link>
              );
          }
        })}
      </div>
    </div>
  );
};

export default HundredLvlCourses;
