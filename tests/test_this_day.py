from scripts import build_this_day as b


def test_by_day_is_dense_and_keeps_missing():
    rows = [(1818, 1, 1, -1), (1818, 1, 2, 10), (1819, 1, 1, 20), (1820, 2, 29, 5), (1820, 3, 1, 7)]
    by_day, yearly = b.build(rows)
    assert by_day["first_year"] == 1818 and by_day["last_year"] == 1820 and by_day["last_date"] == "1820-03-01"
    assert by_day["days"]["01-01"] == [-1, 20, -1]
    assert by_day["days"]["02-29"] == [-1, -1, 5]
    assert yearly == [[1818, 10.0, 1], [1819, 20.0, 1], [1820, 6.0, 2]]  # -1 not averaged


def test_real_csv_size_and_known_value():
    by_day, _ = b.build(b.read_rows())
    assert len(by_day["days"]) == 366
    # data/silso_daily.csv: 2000;01;01;2000.001;  71;...
    assert by_day["days"]["01-01"][2000 - by_day["first_year"]] == 71
