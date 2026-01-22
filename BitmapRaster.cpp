#include "BitmapRaster.h"

#include <QDebug>

BitmapRaster::BitmapRaster()
{

}

QString BitmapRaster::ImageLine2Line(const cv::Mat &image, BitmapRasterConfig config, QPointF StartPosition)
{
    //1、图像预处理 将高度缩放到：输出高度*线密度
    cv::Mat resized;
    cv::resize(image, resized, cv::Size(config.Density * config.Width, config.Density * config.Height), 0, 0, cv::INTER_NEAREST);
    cv::imwrite(QString("/home/linaro/Templates/Aftercure.jpg").arg(config.Aftercure).toStdString().c_str(),resized);

    cv::Mat Processing;
    switch (config.Aftercure)
    {
    case BitmapRasterConfig::NoProcessing:
        Processing = resized.clone();
        break;
    case BitmapRasterConfig::HalftoneFilter:
        Processing = HalftoneFilter(resized,config);
        break;
    case BitmapRasterConfig::FloydSteinberg:
        Processing = FloydSteinberg(resized,config);
        break;
    }
    cv::imwrite(QString("/home/linaro/Templates/Aftercure_%1.jpg").arg(config.Aftercure).toStdString().c_str(),Processing);

    cv::Mat grayImage;
    if (Processing.channels() > 1)
    {
        cv::cvtColor(Processing, grayImage, cv::COLOR_BGR2GRAY);
    }
    else
    {
        grayImage = Processing.clone();
    }
    //3、光栅化
    QVector<QVector<RasterSegment>> BitmapRasterSegment = this->GetSegments(grayImage,config);

    //4、转G代码
    QString Output = "";
    Output += "(BitmapRaster)\n";
    Output += "(V1.0.0)\n";
    Output += "(2025-11-15)\n\n";


    Output += "G90\n";
    Output += "M4\n";

    QPointF currentPosition = StartPosition;
    bool isEven = false;

    //<------
    currentPosition.setX(currentPosition.x() - config.Padding);
    Output += QString("G0 X%1 Y%2\n").arg(currentPosition.x()).arg(currentPosition.y());

    for(int j = BitmapRasterSegment.size() - 1; j >= 0; j--)
    {
        auto Raster = BitmapRasterSegment.at(j);
        if(!isEven)
        {
            if(config.Padding != 0)
            {
                //------>
                currentPosition.setX(currentPosition.x() + config.Padding);
                Output += QString("G0 X%1 Y%2 S0\n").arg(currentPosition.x(), 0, 'f', 3).arg(currentPosition.y(), 0, 'f', 3);
            }
            for(int i = 0; i < Raster.size(); i++)
            {
                //        -----------------------------------
                Output += Raster.at(i).GCode(config,currentPosition,isEven);
            }
            //                                               ------>
            currentPosition.setX(currentPosition.x() + config.Padding);
            currentPosition.setY(currentPosition.y() + 1.0 / config.Density);
            Output += QString("G0 X%1 Y%2 S0\n").arg(currentPosition.x(), 0, 'f', 3).arg(currentPosition.y(), 0, 'f', 3);
        }
        else
        {
            if(config.Padding != 0)
            {
                //                                          <------
                currentPosition.setX(currentPosition.x() - config.Padding);
                Output += QString("G0 X%1 Y%2 S0\n").arg(currentPosition.x(), 0, 'f', 3).arg(currentPosition.y(), 0, 'f', 3);
            }
            for(int i = Raster.size() - 1; i >= 0; i--)
            {
                //        -----------------------------------
                Output += Raster.at(i).GCode(config,currentPosition,isEven);
            }

            //<------
            currentPosition.setX(currentPosition.x() - config.Padding);
            currentPosition.setY(currentPosition.y() + 1.0 / config.Density);
            Output += QString("G0 X%1 Y%2 S0\n").arg(currentPosition.x(), 0, 'f', 3).arg(currentPosition.y(), 0, 'f', 3);
        }
        isEven = !isEven;
    }
    Output += "G0 X0 Y0 S0\n";
    Output += "M5\n";

    return Output;
}

cv::Mat BitmapRaster::HalftoneFilter(cv::Mat image,const BitmapRasterConfig& config)
{
    CV_Assert(!image.empty());
    double dotSize = config.HFC.DotSize;
    double minDotRatio = config.HFC.MinDotRatio;
    const double dotRadius = dotSize / 2.0;
    double radiusGamma = config.HFC.Gamma;
    const double angleRad = config.HFC.AngleRad * M_PI / 180.0;

    // convert to gray if needed
    cv::Mat gray;
    if (image.channels() == 1)
    {
        image.copyTo(gray);
    }
    else
    {
        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    }

    const int width = gray.cols;
    const int height = gray.rows;

    const double cosA = std::cos(angleRad);
    const double sinA = std::sin(angleRad);

    const double centerX = width / 2.0;
    const double centerY = height / 2.0;

    std::vector<cv::Point2d> corners =
    {
        {0.0, 0.0},
        {static_cast<double>(width), 0.0},
        {0.0, static_cast<double>(height)},
        {static_cast<double>(width), static_cast<double>(height)}
    };

    double minRotX = std::numeric_limits<double>::infinity();
    double maxRotX = -std::numeric_limits<double>::infinity();
    double minRotY = std::numeric_limits<double>::infinity();
    double maxRotY = -std::numeric_limits<double>::infinity();

    for (const auto& c : corners)
    {
        double tx = c.x - centerX;
        double ty = c.y - centerY;
        double rotX = tx * cosA - ty * sinA;
        double rotY = tx * sinA + ty * cosA;
        minRotX = std::min(minRotX, rotX);
        maxRotX = std::max(maxRotX, rotX);
        minRotY = std::min(minRotY, rotY);
        maxRotY = std::max(maxRotY, rotY);
    }

    const double offsetX = -minRotX;
    const double offsetY = -minRotY;
    const double rotatedWidth = maxRotX - minRotX;
    const double rotatedHeight = maxRotY - minRotY;

    const int gridCols = std::max(1, static_cast<int>(std::ceil(rotatedWidth / dotSize)));
    const int gridRows = std::max(1, static_cast<int>(std::ceil(rotatedHeight / dotSize)));
    const int gridCount = gridCols * gridRows;

    std::vector<float> brightnessSums(gridCount, 0.0f);
    std::vector<int> counts(gridCount, 0);
    std::vector<float> radii(gridCount, 0.0f);

    auto getGridIndex = [&](int gx, int gy) {
        return gy * gridCols + gx;
    };

    for (int y = 0; y < height; ++y)
     {
        double ty = y - centerY;
        for (int x = 0; x < width; ++x)
        {
            double tx = x - centerX;
            double rotX = tx * cosA - ty * sinA;
            double rotY = tx * sinA + ty * cosA;
            double shiftedX = rotX + offsetX;
            double shiftedY = rotY + offsetY;

            int gx = static_cast<int>(std::floor(shiftedX / dotSize));
            int gy = static_cast<int>(std::floor(shiftedY / dotSize));

            if (gx < 0) gx = 0;
            else if (gx >= gridCols) gx = gridCols - 1;
            if (gy < 0) gy = 0;
            else if (gy >= gridRows) gy = gridRows - 1;

            int idx = getGridIndex(gx, gy);
            brightnessSums[idx] += static_cast<float>(gray.at<uchar>(y, x));
            counts[idx] += 1;
        }
    }

    const double minRadius = dotRadius * std::max(0.0, std::min(1.0, minDotRatio));

    for (int i = 0; i < gridCount; ++i) {
        int cnt = counts[i];
        if (cnt == 0) {
            radii[i] = 0.0f;
            continue;
        }
        double avgBrightness = brightnessSums[i] / cnt; // 0..255
        if (avgBrightness <= 0.0) {
            radii[i] = static_cast<float>(dotRadius);
            continue;
        }
        if (avgBrightness >= 255.0) {
            radii[i] = static_cast<float>(minRadius * 0.5);
            continue;
        }
        double radiusRatio = 1.0 - (avgBrightness / 255.0);
        if (std::abs(radiusGamma - 1.0) > 1e-9)
        {
            radiusRatio = std::pow(radiusRatio, radiusGamma);
        }
        radii[i] = static_cast<float>(std::max(dotRadius * radiusRatio, minRadius));
    }

    cv::Mat out(height, width, CV_8UC1, cv::Scalar(255));

    // Second pass: set pixels to black if inside dot radius
    for (int y = 0; y < height; ++y)
    {
        double ty = y - centerY;
        for (int x = 0; x < width; ++x)
        {
            double tx = x - centerX;
            double rotX = tx * cosA - ty * sinA;
            double rotY = tx * sinA + ty * cosA;
            double shiftedX = rotX + offsetX;
            double shiftedY = rotY + offsetY;

            int gx = static_cast<int>(std::floor(shiftedX / dotSize));
            int gy = static_cast<int>(std::floor(shiftedY / dotSize));

            if (gx < 0) gx = 0;
            else if (gx >= gridCols) gx = gridCols - 1;
            if (gy < 0) gy = 0;
            else if (gy >= gridRows) gy = gridRows - 1;

            int gridIdx = getGridIndex(gx, gy);
            double centerRotX = gx * dotSize + dotRadius;
            double centerRotY = gy * dotSize + dotRadius;
            double dx = shiftedX - centerRotX;
            double dy = shiftedY - centerRotY;
            double distanceSq = dx * dx + dy * dy;
            double maxRadius = radii[gridIdx];
            double maxRadiusSq = maxRadius * maxRadius;

            if (distanceSq <= maxRadiusSq)
            {
                out.at<uchar>(y, x) = 0;
            }
        }
    }
    return out.clone();
}

cv::Mat BitmapRaster::FloydSteinberg(cv::Mat image,const BitmapRasterConfig& config)
{
    CV_Assert(!image.empty());
    cv::Mat gray;
    if (image.channels() == 1)
    {
        image.copyTo(gray);
    }
    else
    {
        cv::cvtColor(image, gray, cv::COLOR_BGR2GRAY);
    }

    int width = gray.cols;
    int height = gray.rows;

    int threshold = config.FSC.Threshold;

    // 转为 float 以便保存误差
    cv::Mat lum = gray.clone();
    lum.convertTo(lum, CV_32F);

    cv::Mat out = cv::Mat::zeros(height, width, CV_8UC1);

    for (int y = 0; y < height; y++)
    {
        float* lumRow = lum.ptr<float>(y);

        for (int x = 0; x < width; x++)
        {
            float oldValue = lumRow[x];
            float newValue = oldValue < threshold ? 0.0f : 255.0f;
            float error = oldValue - newValue;

            out.at<uchar>(y, x) = static_cast<uchar>(newValue);

            // 分配误差的 lambda
            auto distribute = [&](int tx, int ty, float factor)
            {
                if (tx >= 0 && tx < width && ty >= 0 && ty < height)
                {
                    lum.at<float>(ty, tx) += error * factor;
                }
            };

            // Floyd-Steinberg diffusion
            distribute(x + 1, y,     7.0f / 16.0f);
            distribute(x - 1, y + 1, 3.0f / 16.0f);
            distribute(x,     y + 1, 5.0f / 16.0f);
            distribute(x + 1, y + 1, 1.0f / 16.0f);
        }
    }

    return out.clone();
}

QVector<QVector<RasterSegment> > BitmapRaster::GetSegments(const cv::Mat &image,const BitmapRasterConfig& config)
{
    QVector<QVector<RasterSegment>> Bitmap;

    for(int y = 0; y < image.rows; y++)
    {
        QVector<RasterSegment> Raster;
        RasterSegment Segment;

        for(int x = 0; x < image.cols; x++)
        {
            int p = this->Power(image.at<uchar>(y, x),config);

            if(Segment.Power != p)
            {
                Raster.push_back(Segment);
                Segment.Power = p;
                Segment.Pixel = 0;
            }
            Segment.Pixel += 1;

            if(x == image.cols - 1)
            {
                Raster.push_back(Segment);
            }
        }

        Bitmap.push_back(Raster);
    }

    return Bitmap;
}

int BitmapRaster::Power(uchar gray, const BitmapRasterConfig &config)
{
    if(config.EnablePowerFollow)
    {
        int p = ceil((config.PowerMax - config.PowerMin) * (255 - gray) / 255) + config.PowerMin;

        return p >= config.PowerOutputThreshold ? p : 0;
    }
    else
    {
        return gray <= config.MaxGrayOutput ? config.PowerMax : 0;
    }
}

QString RasterSegment::GCode(const BitmapRasterConfig &config, QPointF &CurrentPosition, bool isEven) const
{
    if(isEven)
    {
        CurrentPosition.setX(CurrentPosition.x() - ((double)Pixel / config.Density));
    }
    else
    {
        CurrentPosition.setX(CurrentPosition.x() + ((double)Pixel / config.Density));
    }
    if(Power > 0)
    {
        return QString("G1 X%1 Y%2 S%3\n").arg(CurrentPosition.x(), 0, 'f', 3).arg(CurrentPosition.y(), 0, 'f', 3).arg(Power);
    }
    else
    {
        return QString("G0 X%1 Y%2 S0\n").arg(CurrentPosition.x(), 0, 'f', 3).arg(CurrentPosition.y(), 0, 'f', 3);
    }
}
