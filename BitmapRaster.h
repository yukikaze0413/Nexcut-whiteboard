#ifndef BITMAPRASTER_H
#define BITMAPRASTER_H

#include <QPoint>
#include <QString>
#include <QVector>

#include <opencv2/opencv.hpp>

struct BitmapRasterConfig
{
    enum RasterDirection
    {
        Horizontal,
        Vertical
    };

    double Width = 100;                         //宽度
    double Height = 100;                        //高度
    int Density = 16;                           //线密度
    int Padding = 5;                            //留边距离
    RasterDirection Direction = Horizontal;     //方向


    int PowerMax = 100;                         //最大功率
    int PowerMin = 0;                           //最小功率
    int PowerOutputThreshold = 10;              //功率输出门限 低于此值将不输出
    int MaxGrayOutput = 125;                    //最大灰度输出值 灰度高于于此值将不输出
    bool EnablePowerFollow = false;             //启用功率-灰度随动

    enum ImageAftercure
    {
        NoProcessing,
        HalftoneFilter,
        FloydSteinberg
    };

    ImageAftercure Aftercure = NoProcessing;    //图像处理

    struct HalftoneFilterConfig
    {
        double DotSize = 6;
        double MinDotRatio = 0.23;
        double Gamma = 0.7;
        int AngleRad = 30;
    };
    HalftoneFilterConfig HFC;

    struct FloydSteinbergConfig
    {
        int Threshold = 128;    //二值化的分界点
    };
    FloydSteinbergConfig FSC;
};

//段
struct RasterSegment
{
    int Pixel = 0;
    int Power = 0;

    QString GCode(const BitmapRasterConfig& config, QPointF& CurrentPosition,bool isEven) const;
};


class BitmapRaster
{
public:
    BitmapRaster();

    QString ImageLine2Line(const cv::Mat& image,BitmapRasterConfig config,QPointF StartPosition);

    /**
     * 半调网屏
     * @brief HalftoneFilter
     * @param image
     * @param config
     * @return
     */
    static cv::Mat HalftoneFilter(cv::Mat image,const BitmapRasterConfig& config);

    /**
     * 1-Bit抖动
     * @brief FloydSteinberg
     * @param image
     * @param config
     * @return
     */
    static cv::Mat FloydSteinberg(cv::Mat image,const BitmapRasterConfig& config);

private:
    QVector<QVector<RasterSegment>> GetSegments(const cv::Mat& image,const BitmapRasterConfig& config);

    int Power(uchar gray,const BitmapRasterConfig& config);
};

#endif // BITMAPRASTER_H
