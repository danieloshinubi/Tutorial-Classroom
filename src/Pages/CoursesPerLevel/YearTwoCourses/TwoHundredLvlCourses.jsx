import React from "react";
import { Link } from "react-router-dom";
import { YearStyle } from "../YearStyle";

const TwoHundredLvlCourses = () => {
  const lvlCourseList = [
    { course_id: "1", course: "GEDS221" },
    { course_id: "2", course: "COSC205" },
    { course_id: "3", course: "STAT201" },
    { course_id: "4", course: "MATH203" },
    { course_id: "5", course: "GEDS215" },
    { course_id: "6", course: "COSC209" },
    { course_id: "7", course: "COSC203" },
    { course_id: "8", course: "GEDS260" },
    { course_id: "9", course: "COSC206" },
    { course_id: "10", course: "MATH206" },
    { course_id: "11", course: "GEDS270" },
    { course_id: "12", course: "COSC222" },
    { course_id: "13", course: "STAT202" },
    { course_id: "14", course: "COSC226" },
    { course_id: "15", course: "COSC212" },
    { course_id: "16", course: "GEDS200" },
    { course_id: "17", course: "GEDS222" },
  ];

  return (
    <div className="TwoHundredLvlCourses">
      <h1 style={YearStyle.headStyle}>{"200 Level Courses:"}</h1>
      <div style={YearStyle}>
        {lvlCourseList.map((code, i) => {
          switch (code.course_id) {
            case "1":
              return (
                <Link
                  to={"/Levels/200/Courses/GEDS221"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "2":
              return (
                <Link
                  to={"/Levels/200/Courses/COSC205"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "3":
              return (
                <Link
                  to={"/Levels/200/Courses/STAT201"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
            case "4":
              return (
                <Link
                  to={"/Levels/200/Courses/MATH203"}
                  style={YearStyle.linkStyle}
                >
                  <div
                    key={code.course_id}
                    style={YearStyle.boxStyle}
                    className="level-box"
                  >
                    <h2>{code.course}</h2>
                  </div>
                </Link>
              );
          }
          //   return (
          //     <div key={code.course_id}>
          //       <h1>{code.course}</h1>
          //     </div>
          //   );
        })}
      </div>
    </div>
  );
};

export default TwoHundredLvlCourses;
