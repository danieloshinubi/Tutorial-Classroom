import React from "react";
import { Link } from "react-router-dom";
import { YearStyle } from "../YearStyle";

const ThreeHundredCourses = () => {
  const lvlCourseList = [
    { course_id: "1", course: "COSC303" },
    { course_id: "2", course: "GEDS317" },
    { course_id: "3", course: "COSC335" },
    { course_id: "4", course: "COSC327" },
    { course_id: "5", course: "GEDS280" },
    { course_id: "6", course: "COSC309" },
    { course_id: "7", course: "COSC325" },
    { course_id: "8", course: "COSC305" },
    { course_id: "9", course: "ITGY307" },
    { course_id: "10", course: "COSC317" },
    { course_id: "11", course: "COSC312" },
    { course_id: "12", course: "COSC302" },
    { course_id: "13", course: "GEDS312" },
    { course_id: "14", course: "COSC360" },
    { course_id: "15", course: "COSC328" },
    { course_id: "16", course: "COSC306" },
  ];
  return (
    <div className="ThreeHundredCourses">
      <h1 style={YearStyle.headStyle}>{"300 Level Courses:"}</h1>
      <div style={YearStyle}>
        {lvlCourseList.map((code, i) => {
          switch (code.course_id) {
            case "1":
              return (
                <Link
                  to={"/Levels/300/Courses/STAT101"}
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
                  to={"/Levels/300/Courses/STAT101"}
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
                  to={"/Levels/300/Courses/STAT101"}
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
                  to={"/Levels/300/Courses/STAT101"}
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
        })}
      </div>
    </div>
  );
};

export default ThreeHundredCourses;
